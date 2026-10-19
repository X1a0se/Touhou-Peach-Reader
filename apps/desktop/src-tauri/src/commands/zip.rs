//! ZIP 命令（design §5.5 / §14.4）：流式解压与打包，zip-slip/符号链接/超限条目进 rejected。

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const MAX_ENTRIES: usize = 100_000;
const MAX_TOTAL_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_RATIO: u64 = 200;

fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("EIO: 无法定位 app data 目录：{e}"))
}

fn ensure_within(root: &Path, candidate: &str, allow_missing: bool) -> Result<PathBuf, String> {
    let root = if root.exists() {
        root.canonicalize().map_err(|e| format!("EIO: {e}"))?
    } else {
        fs::create_dir_all(root).map_err(|e| format!("EIO: {e}"))?;
        root.canonicalize().map_err(|e| format!("EIO: {e}"))?
    };
    let candidate = Path::new(candidate);
    let resolved = if candidate.exists() {
        candidate.canonicalize().map_err(|e| format!("EIO: {e}"))?
    } else if allow_missing {
        let parent = candidate.parent().unwrap_or(Path::new(""));
        let name = candidate
            .file_name()
            .ok_or_else(|| "EINVAL: 路径没有文件名".to_string())?;
        let parent = if parent.as_os_str().is_empty() {
            root.clone()
        } else {
            if !parent.exists() {
                fs::create_dir_all(parent).map_err(|e| format!("EIO: {e}"))?;
            }
            parent.canonicalize().map_err(|e| format!("ENOENT: {e}"))?
        };
        parent.join(name)
    } else {
        return Err(format!("ENOENT: 路径不存在：{}", candidate.display()));
    };
    if !resolved.starts_with(&root) {
        return Err(format!(
            "EACCES: 路径越界（只允许 app data 目录）：{}",
            resolved.display()
        ));
    }
    Ok(resolved)
}

fn is_safe_relative(name: &str) -> bool {
    if name.starts_with('/') || name.starts_with('\\') {
        return false;
    }
    if name.contains(':') {
        return false;
    }
    let path = Path::new(name);
    path.components().all(|c| matches!(c, Component::Normal(_) | Component::CurDir))
}

fn is_symlink<R: Read + ?Sized>(archive_file: &zip::read::ZipFile<'_, R>) -> bool {
    archive_file
        .unix_mode()
        .map(|m| m & 0o170000 == 0o120000)
        .unwrap_or(false)
}

/// 解压整个包。返回 `{entries, bytes, rejected}`，永不因单条坏条目中断。
pub fn extract_all(zip_path: &str, dest_dir: &str) -> Result<serde_json::Value, String> {
    let file = File::open(zip_path).map_err(|e| format!("ENOENT: {e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("E_ZIP: {e}"))?;
    fs::create_dir_all(dest_dir).map_err(|e| format!("EIO: {e}"))?;

    let mut rejected: Vec<serde_json::Value> = Vec::new();
    let mut entries: usize = 0;
    let mut total: u64 = 0;
    let mut buffer = vec![0u8; 64 * 1024];

    for i in 0..archive.len() {
        let mut entry = match archive.by_index(i) {
            Ok(e) => e,
            Err(err) => {
                rejected.push(serde_json::json!({"entry": format!("#{i}"), "reason": format!("读取条目失败：{err}")}));
                continue;
            }
        };
        let raw_name = match entry.name() {
            Ok(name) => name.to_string(),
            Err(err) => {
                rejected.push(serde_json::json!({"entry": format!("#{i}"), "reason": format!("条目名非 UTF-8：{err}")}));
                continue;
            }
        };
        if raw_name.starts_with("__MACOSX/") || raw_name.starts_with("._") {
            continue;
        }
        if entry.is_dir() {
            continue;
        }
        if is_symlink(&entry) {
            rejected.push(serde_json::json!({"entry": raw_name, "reason": "符号链接不允许"}));
            continue;
        }
        if !is_safe_relative(&raw_name) {
            rejected.push(serde_json::json!({"entry": raw_name, "reason": "非法路径（zip-slip）"}));
            continue;
        }
        if entries >= MAX_ENTRIES {
            rejected.push(serde_json::json!({"entry": raw_name, "reason": "条目数超限"}));
            continue;
        }
        let size = entry.size();
        if size > MAX_FILE_BYTES {
            rejected.push(serde_json::json!({"entry": raw_name, "reason": "单文件过大"}));
            continue;
        }
        let compressed = entry.compressed_size().max(1);
        if size / compressed > MAX_RATIO {
            rejected.push(serde_json::json!({"entry": raw_name, "reason": "压缩比异常"}));
            continue;
        }
        if total.saturating_add(size) > MAX_TOTAL_BYTES {
            rejected.push(serde_json::json!({"entry": raw_name, "reason": "总体积超限"}));
            continue;
        }

        let target = Path::new(dest_dir).join(&raw_name);
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|e| format!("EIO: {e}"))?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("EIO: {e}"))?;
        }
        let mut out = File::create(&target).map_err(|e| format!("EIO: {e}"))?;
        let mut written: u64 = 0;
        loop {
            let read = entry.read(&mut buffer).map_err(|e| format!("E_ZIP: {e}"))?;
            if read == 0 {
                break;
            }
            if written + read as u64 > MAX_FILE_BYTES {
                rejected.push(serde_json::json!({"entry": raw_name, "reason": "解压后超限"}));
                let _ = fs::remove_file(&target);
                break;
            }
            out.write_all(&buffer[..read]).map_err(|e| format!("EIO: {e}"))?;
            written += read as u64;
        }
        total += written;
        entries += 1;
    }

    Ok(serde_json::json!({
        "entries": entries,
        "bytes": total,
        "rejected": rejected,
    }))
}

/// 目录打包。`order` 中的相对路径最后写（默认 `manifest.json` 最后）。
pub fn create_from_dir(
    dir_path: &str,
    zip_path: &str,
    order: Vec<String>,
) -> Result<serde_json::Value, String> {
    let root = Path::new(dir_path);
    let mut files: Vec<(String, PathBuf)> = Vec::new();
    for entry in walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .map_err(|e| format!("EIO: {e}"))?
            .to_string_lossy()
            .replace('\\', "/");
        files.push((relative, path.to_path_buf()));
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));

    let last: Vec<String> = order;
    files.sort_by_key(|(name, _)| last.iter().position(|p| p == name).map_or(0, |pos| 1 + pos));

    let out = File::create(zip_path).map_err(|e| format!("EIO: {e}"))?;
    let mut writer = ZipWriter::new(out);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut bytes: u64 = 0;

    for (name, path) in &files {
        writer
            .start_file(name.as_str(), options)
            .map_err(|e| format!("E_ZIP: {e}"))?;
        let mut input = File::open(path).map_err(|e| format!("EIO: {e}"))?;
        let copied = std::io::copy(&mut input, &mut writer).map_err(|e| format!("EIO: {e}"))?;
        bytes += copied;
    }
    writer.finish().map_err(|e| format!("E_ZIP: {e}"))?;

    Ok(serde_json::json!({"entries": files.len(), "bytes": bytes}))
}

#[tauri::command]
pub async fn zip_extract_all(
    app: AppHandle,
    zip_path: String,
    dest_dir: String,
) -> Result<serde_json::Value, String> {
    let root = app_data(&app)?;
    let zip = ensure_within(&root, &zip_path, false)?;
    let dest = ensure_within(&root, &dest_dir, true)?;
    tauri::async_runtime::spawn_blocking(move || {
        extract_all(&zip.to_string_lossy(), &dest.to_string_lossy())
    })
    .await
    .map_err(|e| format!("EIO: {e}"))?
}

#[tauri::command]
pub async fn zip_create_from_dir(
    app: AppHandle,
    dir_path: String,
    zip_path: String,
    order: Option<Vec<String>>,
) -> Result<serde_json::Value, String> {
    let root = app_data(&app)?;
    let dir = ensure_within(&root, &dir_path, false)?;
    let zip = ensure_within(&root, &zip_path, true)?;
    tauri::async_runtime::spawn_blocking(move || {
        create_from_dir(
            &dir.to_string_lossy(),
            &zip.to_string_lossy(),
            order.unwrap_or_else(|| vec!["manifest.json".to_string()]),
        )
    })
    .await
    .map_err(|e| format!("EIO: {e}"))?
}
