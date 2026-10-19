//! Tauri 壳层。
//!
//! 设计文档 §14：前端只通过 `@tauri-apps/api` 与两个官方插件通信；
//! 文件系统与 ZIP 的 Rust 命令在 Goal 3 加入（统一做 app data 目录校验）。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
