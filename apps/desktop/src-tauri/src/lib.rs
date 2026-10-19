//! Tauri 壳层。
//!
//! 设计文档 §14：前端只通过 `@tauri-apps/api` 与两个官方插件通信；
//! 文件系统与 ZIP 走自研命令（`commands/`），统一做 app data 目录校验。

mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            commands::wallpaper::import_wallpaper,
            commands::fs::save_export,
            commands::fs::stage_import,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
