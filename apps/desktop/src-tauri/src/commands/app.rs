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

const UNINSTALL_KEY: &str =
    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Touhou Peach Reader";

fn registry_value(output: &str, name: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let trimmed = line.trim();
        let rest = trimmed.strip_prefix(name)?;
        let rest = rest.trim_start();
        let rest = rest.strip_prefix("REG_SZ")?;
        Some(rest.trim().trim_matches('"').to_string())
    })
}

#[cfg(windows)]
#[tauri::command]
pub fn install_info() -> Result<Option<InstallInfo>, String> {
    let output = std::process::Command::new("reg")
        .args(["query", UNINSTALL_KEY])
        .output()
        .map_err(|e| format!("EIO: 无法读取安装信息：{e}"))?;
    if !output.status.success() {
        return Ok(None);
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let Some(location) = registry_value(&text, "InstallLocation") else {
        return Ok(None);
    };
    let version = registry_value(&text, "DisplayVersion").unwrap_or_default();
    if location.is_empty() {
        return Ok(None);
    }
    Ok(Some(InstallInfo { location, version }))
}

#[cfg(not(windows))]
#[tauri::command]
pub fn install_info() -> Result<Option<InstallInfo>, String> {
    Ok(None)
}
