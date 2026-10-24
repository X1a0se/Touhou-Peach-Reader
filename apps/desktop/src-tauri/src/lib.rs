//! Tauri 壳层。
//!
//! 设计文档 §14：前端只通过 `@tauri-apps/api` 与两个官方插件通信；
//! 文件系统与 ZIP 走自研命令（`commands/`），统一做 app data 目录校验。

mod commands;

/// 免安装版把 WebView2 的配置放在 exe 同目录，避免系统级 WebView2 配置损坏时无法启动。
///
/// 只有可写目录才启用；安装版（Program Files）创建失败时回退到 WebView2 默认目录。
fn configure_webview2_profile() {
    if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_some() {
        return;
    }
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let Some(dir) = exe.parent() else {
        return;
    };
    let profile = dir.join("data").join("EBWebView");
    if std::fs::create_dir_all(&profile).is_ok() {
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", profile);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure_webview2_profile();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::fs::fs_read_text,
            commands::fs::fs_read_bytes,
            commands::fs::fs_write_text,
            commands::fs::fs_write_bytes,
            commands::fs::fs_exists,
            commands::fs::fs_stat,
            commands::fs::fs_list_dir,
            commands::fs::fs_mkdir,
            commands::fs::fs_remove,
            commands::fs::fs_rename,
            commands::fs::fs_copy,
            commands::zip::zip_extract_all,
            commands::zip::zip_create_from_dir,
            commands::zip::zip_create_from_dir_to,
            commands::wallpaper::import_wallpaper,
            commands::fs::stage_import,
            commands::app::app_info,
            commands::app::install_info,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
