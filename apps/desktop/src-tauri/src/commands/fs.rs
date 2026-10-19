//! 文件系统命令（design §14.4）。
//!
//! 全部先过 `ensure_within(&app_data_dir, ...)`：JS 只能碰 app data 目录内的路径。
//! 错误统一成 `"ECODE: 可读信息"` 字符串，TS 侧 `mapNativeError()` 只看 ECODE 前缀。

use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("EIO: 无法定位 app data 目录：{e}"))
}

fn normalize_root(root: &Path) -> Result<PathBuf, String> {
    if root.exists() {
        root.canonicalize().map_err(|e| format!("EIO: {e}"))
    } else {
        fs::create_dir_all(root).map_err(|e| format!("EIO: {e}"))?;
        root.canonicalize().map_err(|e| format!("EIO: {e}"))
    }
}

/// 允许目标不存在（写入场景）：此时对父目录做 canonicalize 再拼接文件名。
fn ensure_within(root: &Path, candidate: &str, allow_missing: bool) -> Result<PathBuf, String> {
    let root = normalize_root(root)?;
    let candidate = Path::new(candidate);
    let resolved = if candidate.exists() {
        candidate
            .canonicalize()
            .map_err(|e| format!("EIO: {e}"))?
    } else if allow_missing {
        let parent = candidate
            .parent()
            .ok_or_else(|| "EINVAL: 路径没有父目录".to_string())?;
        let name = candidate
            .file_name()
            .ok_or_else(|| "EINVAL: 路径没有文件名".to_string())?;
        let parent = if parent.as_os_str().is_empty() {
            root.clone()
        } else if parent.exists() {
            parent.canonicalize().map_err(|e| format!("ENOENT: {e}"))?
        } else {
            fs::create_dir_all(parent).map_err(|e| format!("EIO: {e}"))?;
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

fn resolve(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    ensure_within(&app_data(app)?, path, false)
}

fn resolve_for_write(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    ensure_within(&app_data(app)?, path, true)
}

fn io_err(e: std::io::Error) -> String {
    let code = match e.kind() {
        std::io::ErrorKind::NotFound => "ENOENT",
        std::io::ErrorKind::PermissionDenied => "EACCES",
        std::io::ErrorKind::AlreadyExists => "EEXIST",
        _ => "EIO",
    };
    format!("{code}: {e}")
}

#[tauri::command]
pub async fn fs_read_text(app: AppHandle, path: String) -> Result<String, String> {
    let path = resolve(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || fs::read_to_string(&path).map_err(io_err))
        .await
        .map_err(|e| format!("EIO: {e}"))?
}

#[tauri::command]
pub async fn fs_read_bytes(app: AppHandle, path: String) -> Result<Vec<u8>, String> {
    let path = resolve(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || fs::read(&path).map_err(io_err))
        .await
        .map_err(|e| format!("EIO: {e}"))?
}

#[tauri::command]
pub async fn fs_write_text(app: AppHandle, path: String, text: String) -> Result<(), String> {
    let path = resolve_for_write(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || write_atomic(&path, text.as_bytes()))
        .await
        .map_err(|e| format!("EIO: {e}"))?
}

#[tauri::command]
pub async fn fs_write_bytes(app: AppHandle, path: String, bytes: Vec<u8>) -> Result<(), String> {
    let path = resolve_for_write(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || write_atomic(&path, &bytes))
        .await
        .map_err(|e| format!("EIO: {e}"))?
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(io_err)?;
    }
    let tmp = path.with_extension(format!(
        "{}.tmp",
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| format!("{e}."))
            .unwrap_or_default()
    ));
    fs::write(&tmp, bytes).map_err(io_err)?;
    if path.exists() {
        fs::remove_file(path).map_err(io_err)?;
    }
    fs::rename(&tmp, path).map_err(io_err)
}

#[tauri::command]
pub async fn fs_exists(app: AppHandle, path: String) -> Result<bool, String> {
    let path = resolve_for_write(&app, &path)?;
    Ok(path.exists())
}

#[tauri::command]
pub async fn fs_stat(app: AppHandle, path: String) -> Result<serde_json::Value, String> {
    let path = resolve(&app, &path)?;
    let meta = fs::metadata(&path).map_err(io_err)?;
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(serde_json::json!({
        "size": meta.len(),
        "mtimeMs": mtime_ms,
        "isFile": meta.is_file(),
        "isDirectory": meta.is_dir(),
    }))
}

#[tauri::command]
pub async fn fs_list_dir(app: AppHandle, path: String) -> Result<Vec<serde_json::Value>, String> {
    let path = resolve(&app, &path)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(&path).map_err(io_err)? {
        let entry = entry.map_err(io_err)?;
        let file_type = entry.file_type().map_err(io_err)?;
        let child = entry.path();
        out.push(serde_json::json!({
            "name": entry.file_name().to_string_lossy(),
            "path": child.to_string_lossy(),
            "isDirectory": file_type.is_dir(),
        }));
    }
    out.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    Ok(out)
}

#[tauri::command]
pub async fn fs_mkdir(app: AppHandle, path: String) -> Result<(), String> {
    let path = resolve_for_write(&app, &path)?;
    fs::create_dir_all(&path).map_err(io_err)
}

#[tauri::command]
pub async fn fs_remove(app: AppHandle, path: String, recursive: bool) -> Result<(), String> {
    let path = resolve(&app, &path)?;
    let meta = fs::symlink_metadata(&path).map_err(io_err)?;
    if meta.is_dir() {
        if recursive {
            fs::remove_dir_all(&path).map_err(io_err)
        } else {
            fs::remove_dir(&path).map_err(io_err)
        }
    } else {
        fs::remove_file(&path).map_err(io_err)
    }
}

#[tauri::command]
pub async fn fs_rename(app: AppHandle, from: String, to: String) -> Result<(), String> {
    let from = resolve(&app, &from)?;
    let to = resolve_for_write(&app, &to)?;
    if to.exists() {
        let meta = fs::symlink_metadata(&to).map_err(io_err)?;
        if meta.is_dir() {
            fs::remove_dir_all(&to).map_err(io_err)?;
        } else {
            fs::remove_file(&to).map_err(io_err)?;
        }
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(io_err)?;
    }
    fs::rename(&from, &to).map_err(io_err)
}

#[tauri::command]
pub async fn fs_copy(app: AppHandle, from: String, to: String) -> Result<(), String> {
    let from = resolve(&app, &from)?;
    let to = resolve_for_write(&app, &to)?;
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(io_err)?;
    }
    fs::copy(&from, &to).map(|_| ()).map_err(io_err)
}

/// 导出保存：唯一的例外——路径由用户在系统保存对话框里选定，因此不做 app data 限制。
/// 仍然强制 `.tpr` 后缀与"父目录必须已存在"，不允许借它创建目录树或写任意文件名。
#[tauri::command]
pub async fn save_export(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let has_tpr_ext = target
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("tpr"))
        .unwrap_or(false);
    if !has_tpr_ext {
        return Err("EINVAL: 导出文件必须以 .tpr 结尾".to_string());
    }
    if !target.is_absolute() {
        return Err("EINVAL: 需要绝对路径".to_string());
    }
    let parent = target
        .parent()
        .ok_or_else(|| "EINVAL: 路径没有父目录".to_string())?;
    if !parent.exists() {
        return Err("ENOENT: 目标目录不存在".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || write_atomic(&target, &bytes))
        .await
        .map_err(|e| format!("EIO: {e}"))?
}
