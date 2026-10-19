//! 壁纸导入（Goal 14，design §14.4）。
//!
//! 用户选择的图片在 app data 之外，所以这里允许读任意绝对路径，
//! 但**写入目标只能是** `$APPDATA/wallpapers/`；校验包含扩展名、大小与文件头。

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const MAX_BYTES: u64 = 20 * 1024 * 1024;
const EXTENSIONS: [&str; 4] = ["png", "jpg", "jpeg", "webp"];

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportWallpaperResult {
    pub file_name: String,
    pub bytes: u64,
}

fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("EIO: 无法定位 app data 目录：{e}"))
}

fn extension_of(path: &Path) -> Result<String, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .ok_or_else(|| "EINVAL: 无法识别图片扩展名".to_string())?;
    if !EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!("EINVAL: 不支持的壁纸格式：{ext}（仅支持 png/jpg/jpeg/webp）"));
    }
    Ok(ext)
}

/// 只验文件头，不信任扩展名
fn check_magic(bytes: &[u8]) -> bool {
    const PNG: [u8; 8] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if bytes.len() >= 8 && bytes[..8] == PNG {
        return true;
    }
    if bytes.len() >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff {
        return true;
    }
    bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP"
}

#[tauri::command]
pub async fn import_wallpaper(
    app: AppHandle,
    source_path: String,
) -> Result<ImportWallpaperResult, String> {
    let source = PathBuf::from(&source_path);
    if !source.is_absolute() {
        return Err("EINVAL: 需要绝对路径".to_string());
    }
    let ext = extension_of(&source)?;

    tauri::async_runtime::spawn_blocking(move || -> Result<ImportWallpaperResult, String> {
        let meta = fs::metadata(&source).map_err(|e| format!("ENOENT: {e}"))?;
        if !meta.is_file() {
            return Err("EINVAL: 不是普通文件".to_string());
        }
        if meta.len() > MAX_BYTES {
            return Err("E_TOO_LARGE: 壁纸不能超过 20 MB".to_string());
        }
        let bytes = fs::read(&source).map_err(|e| format!("EIO: {e}"))?;
        if !check_magic(&bytes) {
            return Err("EINVAL: 图片内容与扩展名不符（不是 PNG/JPEG/WebP）".to_string());
        }

        let dir = app_data(&app)?.join("wallpapers");
        fs::create_dir_all(&dir).map_err(|e| format!("EIO: {e}"))?;
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let file_name = format!("wp-{stamp}.{ext}");
        let dest = dir.join(&file_name);
        fs::write(&dest, &bytes).map_err(|e| format!("EIO: {e}"))?;

        Ok(ImportWallpaperResult {
            file_name,
            bytes: bytes.len() as u64,
        })
    })
    .await
    .map_err(|e| format!("EIO: {e}"))?
}
