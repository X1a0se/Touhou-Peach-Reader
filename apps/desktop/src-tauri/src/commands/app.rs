//! 运行时信息（Goal 19）。
//!
//! 只读命令：返回编译进 exe 的版本、当前进程的 exe 路径、app data 目录。
//! 「设置 → 关于」用它让用户一眼确认自己跑的是安装版还是免安装版、是不是最新构建。

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    exe_path: String,
    data_dir: String,
}

/// 同步命令，但只做 `current_exe` / `app_data_dir` 两次轻量调用（实测 2–4ms）。
/// 注意：同步 Tauri 命令会占用窗口消息循环，不要在这里 spawn 子进程或做阻塞 IO。
#[tauri::command]
pub fn app_info(app: AppHandle) -> Result<AppInfo, String> {
    let exe = std::env::current_exe().map_err(|e| format!("EIO: 无法定位程序路径：{e}"))?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("EIO: 无法定位 app data 目录：{e}"))?;

    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        exe_path: exe.display().to_string(),
        data_dir: data_dir.display().to_string(),
    })
}

/// 安装版信息（只读注册表）。没装过就返回 `None`。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallInfo {
    location: String,
    version: String,
}

/// 相对 HKCU 的卸载信息键。
///
/// 这里曾经用 `reg query` 读：同步命令 spawn `reg.exe` 会阻塞窗口消息循环
/// （实测一次 3.2 秒），设置页一打开就无响应。改为直接用 `winreg` 读注册表，
/// 并把命令放到阻塞线程池，彻底避免主线程卡死。
#[cfg(windows)]
const UNINSTALL_KEY: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Uninstall\东方桃图吧大书库";

#[cfg(windows)]
fn normalize_install_info(location: String, version: String) -> Option<InstallInfo> {
    let location = location.trim().trim_matches('"').trim().to_string();
    if location.is_empty() {
        return None;
    }
    Some(InstallInfo {
        location,
        version: version.trim().trim_matches('"').to_string(),
    })
}

#[cfg(windows)]
fn read_install_info() -> Result<Option<InstallInfo>, String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let key = match RegKey::predef(HKEY_CURRENT_USER).open_subkey(UNINSTALL_KEY) {
        Ok(key) => key,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("EIO: 无法读取安装信息：{err}")),
    };
    let location: String = key.get_value("InstallLocation").unwrap_or_default();
    let version: String = key.get_value("DisplayVersion").unwrap_or_default();
    Ok(normalize_install_info(location, version))
}

#[cfg(windows)]
#[tauri::command]
pub async fn install_info() -> Result<Option<InstallInfo>, String> {
    // 即使注册表读取偶发变慢，也不能占住主线程：放到阻塞线程池。
    tauri::async_runtime::spawn_blocking(read_install_info)
        .await
        .map_err(|err| format!("EIO: 后台读取安装信息失败：{err}"))?
}

#[cfg(not(windows))]
#[tauri::command]
pub async fn install_info() -> Result<Option<InstallInfo>, String> {
    Ok(None)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn normalize_install_info_trims_quotes_and_rejects_empty_location() {
        assert!(normalize_install_info("  \"\"  ".into(), "0.1.3".into()).is_none());
        assert!(normalize_install_info("   ".into(), "0.1.3".into()).is_none());

        let info = normalize_install_info(
            " \"D:\\东方桃图吧大书库\\\" ".into(),
            " 0.1.3 ".into(),
        )
        .expect("有效安装路径");
        assert_eq!(info.location, "D:\\东方桃图吧大书库\\");
        assert_eq!(info.version, "0.1.3");
    }
}
