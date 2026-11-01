//! 原生网络下载（Goal 11 的回退实现）。
//!
//! WebView 的 fetch 会被 GitHub Release 资产 CDN 的 CORS 拒绝
//!（最终响应没有 Access-Control-Allow-Origin），所以资产下载改走 Rust。
//! GitHub API 的元数据请求仍由前端 fetch 完成（API 允许跨域）。

use std::io::Read;
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::{Channel, Response};
use tauri::Url;
use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
use ureq::Agent;

/// 与 core 的 DEFAULT_MAX_BYTES 保持一致。
const MAX_BYTES: u64 = 256 * 1024 * 1024;
const READ_CHUNK: usize = 64 * 1024;
const PROGRESS_STEP: u64 = 256 * 1024;

/// 通过 Tauri Channel 发给前端的进度。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub received: u64,
    pub total: Option<u64>,
}

/// 只允许 GitHub 自己的 HTTPS 下载域名，避免这个命令被当成任意 SSRF 代理。
fn allowed_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("github.com")
        || host.eq_ignore_ascii_case("www.github.com")
        || host.eq_ignore_ascii_case("api.github.com")
        || host.eq_ignore_ascii_case("objects.githubusercontent.com")
        || host
            .to_ascii_lowercase()
            .ends_with(".githubusercontent.com")
}

fn allowed_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && matches!(url.port(), None | Some(443))
        && url.host_str().is_some_and(allowed_host)
}

/// 读 Windows 系统代理。环境变量优先，其次 HKCU 的 Internet Settings。
///
/// 只支持 HTTP 代理（Clash 默认就是这种）；PAC / SOCKS-only 不处理。
fn system_proxy() -> Option<ureq::Proxy> {
    if let Some(proxy) = ureq::Proxy::try_from_env() {
        return Some(proxy);
    }

    #[cfg(windows)]
    {
        windows_proxy()
    }

    #[cfg(not(windows))]
    {
        None
    }
}

#[cfg(windows)]
fn windows_proxy() -> Option<ureq::Proxy> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")
        .ok()?;
    let enabled: u32 = key.get_value("ProxyEnable").ok()?;
    if enabled == 0 {
        return None;
    }

    let server: String = key.get_value("ProxyServer").ok()?;
    let server = server.trim();
    if server.is_empty() {
        return None;
    }

    let chosen = server
        .split(';')
        .find_map(|part| part.trim().strip_prefix("https="))
        .or_else(|| {
            server
                .split(';')
                .find_map(|part| part.trim().strip_prefix("http="))
        })
        .unwrap_or(server);
    let uri = if chosen.contains("://") {
        chosen.to_string()
    } else {
        format!("http://{chosen}")
    };
    ureq::Proxy::new(&uri).ok()
}

fn build_agent() -> Agent {
    // ureq 的默认 TLS provider 是 rustls，但本项目只启用了 native-tls 特性。
    // 必须显式切到 NativeTls，并使用系统根证书（Windows 下是 SChannel）。
    let tls = TlsConfig::builder()
        .provider(TlsProvider::NativeTls)
        .root_certs(RootCerts::PlatformVerifier)
        .build();
    let config = Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(30)))
        .timeout_global(Some(Duration::from_secs(300)))
        .max_redirects(10)
        .user_agent(format!("TouhouPeachReader/{}", env!("CARGO_PKG_VERSION")))
        .proxy(system_proxy())
        .tls_config(tls)
        .build();
    Agent::new_with_config(config)
}

fn map_ureq_error(error: ureq::Error) -> String {
    match error {
        ureq::Error::StatusCode(code) => format!("EIO: 下载失败（HTTP {code}）"),
        other => format!("EIO: 下载失败：{other}"),
    }
}

/// 同步下载核心；不依赖 Tauri Channel，方便单测。
fn download_bytes(
    url: &str,
    mut on_progress: impl FnMut(DownloadProgress) -> bool,
) -> Result<Vec<u8>, String> {
    let parsed =
        Url::parse(url).map_err(|_| "EINVAL: 只支持 GitHub 的 https 下载地址".to_string())?;
    if !allowed_url(&parsed) {
        return Err("EINVAL: 只支持 GitHub 的 https 下载地址".into());
    }

    let response = build_agent()
        .get(parsed.as_str())
        .header("Accept", "application/octet-stream")
        .call()
        .map_err(map_ureq_error)?;

    let total = response.body().content_length();
    if total.is_some_and(|size| size > MAX_BYTES) {
        return Err("E_TOO_LARGE: 数据库包超过 256 MB 上限".into());
    }
    if !on_progress(DownloadProgress { received: 0, total }) {
        return Err("EIO: 下载已取消".into());
    }

    let mut reader = response.into_body().into_reader();
    let mut data = Vec::with_capacity(total.unwrap_or(0).min(MAX_BYTES) as usize);
    let mut buffer = [0u8; READ_CHUNK];
    let mut received: u64 = 0;
    let mut reported: u64 = 0;

    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| format!("EIO: 下载失败：{error}"))?;
        if read == 0 {
            break;
        }
        received += read as u64;
        if received > MAX_BYTES {
            return Err("E_TOO_LARGE: 数据库包超过 256 MB 上限".into());
        }
        data.extend_from_slice(&buffer[..read]);

        if received - reported >= PROGRESS_STEP {
            if !on_progress(DownloadProgress { received, total }) {
                return Err("EIO: 下载已取消".into());
            }
            reported = received;
        }
    }

    if received != reported {
        if !on_progress(DownloadProgress { received, total }) {
            return Err("EIO: 下载已取消".into());
        }
    }

    Ok(data)
}

/// 下载 GitHub Release 资产并返回原始字节。
///
/// 返回 tauri::ipc::Response，前端 invoke 会直接拿到 ArrayBuffer，
/// 不会把 16 MB 数据序列化成 JSON 数组。
#[tauri::command]
pub async fn network_download(
    url: String,
    progress: Channel<DownloadProgress>,
) -> Result<Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        download_bytes(&url, |update| progress.send(update).is_ok())
    })
    .await
    .map_err(|error| format!("EIO: 下载任务失败：{error}"))??;

    Ok(Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(value: &str) -> Url {
        Url::parse(value).expect("测试 URL 应能解析")
    }

    #[test]
    fn allows_github_download_hosts() {
        assert!(allowed_url(&parse(
            "https://github.com/X1a0se/Touhou-Peach-Reader/releases/download/v1.0.0/a.tpr"
        )));
        assert!(allowed_url(&parse(
            "https://api.github.com/repos/X1a0se/Touhou-Peach-Reader/releases/latest"
        )));
        assert!(allowed_url(&parse(
            "https://release-assets.githubusercontent.com/github-production-release-asset/a"
        )));
        assert!(allowed_url(&parse("https://github.com:443/a")));
    }

    #[test]
    fn rejects_unsafe_urls() {
        assert!(!allowed_url(&parse("http://github.com/a")));
        assert!(!allowed_url(&parse("https://evil.com/a")));
        assert!(!allowed_url(&parse("https://github.com.evil.com/a")));
        assert!(!allowed_url(&parse("https://user:pass@github.com/a")));
        assert!(!allowed_url(&parse("https://github.com:8443/a")));
    }

    #[test]
    #[ignore = "需要网络和系统代理，手动运行"]
    fn downloads_real_release_asset() {
        let url = "https://github.com/X1a0se/Touhou-Peach-Reader/releases/download/v1.0.0/TouhouPeachReader-DB-1.0.0.tpr";
        let data = download_bytes(url, |_| true).expect("真实数据库下载应成功");
        assert!(data.len() > 1_000_000, "下载内容过小：{}", data.len());
        assert!(data.starts_with(b"PK\x03\x04"), "下载内容不是 ZIP");
    }
}
