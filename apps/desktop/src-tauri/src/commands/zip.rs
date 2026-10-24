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

/// 把目录直接写成目标文件：先写同目录 `.partial`，成功后 rename 覆盖。
/// 失败时删除 partial，旧目标保持原样（Windows 的 rename 是替换语义）。
fn create_from_dir_to(
    dir_path: &str,
    target_path: &str,
    order: Vec<String>,
) -> Result<serde_json::Value, String> {
    let target = Path::new(target_path);
    let parent = target
        .parent()
        .ok_or_else(|| "EINVAL: 目标路径没有父目录".to_string())?;
    let file_name = target
        .file_name()
        .ok_or_else(|| "EINVAL: 目标路径没有文件名".to_string())?;
    let partial = parent.join(format!("{}.partial", file_name.to_string_lossy()));

    let result = create_from_dir(dir_path, &partial.to_string_lossy(), order);
    match result {
        Ok(value) => {
            if let Err(error) = fs::rename(&partial, target) {
                let _ = fs::remove_file(&partial);
                return Err(format!("EIO: 无法替换目标文件：{error}"));
            }
            Ok(value)
        }
        Err(error) => {
            let _ = fs::remove_file(&partial);
            Err(error)
        }
    }
}

/// 校验用户保存对话框选定的目标：绝对路径、.tpr 后缀、父目录已存在且不是目录本身。
/// 这是唯一允许写 app data 之外的命令，因此不创建任何目录。
fn resolve_export_target(candidate: &str) -> Result<PathBuf, String> {
    let target = PathBuf::from(candidate);
    if !target.is_absolute() {
        return Err("EINVAL: 导出文件需要绝对路径".to_string());
    }
    let has_tpr_ext = target
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("tpr"))
        .unwrap_or(false);
    if !has_tpr_ext {
        return Err("EINVAL: 导出文件必须以 .tpr 结尾".to_string());
    }
    if target.is_dir() {
        return Err("EINVAL: 目标是一个目录，请选择 .tpr 文件".to_string());
    }
    let parent = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| "EINVAL: 目标路径没有父目录".to_string())?;
    if !parent.is_dir() {
        return Err("ENOENT: 目标目录不存在".to_string());
    }
    let parent = parent.canonicalize().map_err(|e| format!("EIO: {e}"))?;
    let name = target
        .file_name()
        .ok_or_else(|| "EINVAL: 目标路径没有文件名".to_string())?;
    Ok(parent.join(name))
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

/// 导出直写：源目录必须在 app data 内；目标来自系统保存对话框，可以指向任意位置。
#[tauri::command]
pub async fn zip_create_from_dir_to(
    app: AppHandle,
    dir_path: String,
    target_path: String,
    order: Option<Vec<String>>,
) -> Result<serde_json::Value, String> {
    let root = app_data(&app)?;
    let dir = ensure_within(&root, &dir_path, false)?;
    let target = resolve_export_target(&target_path)?;
    if target.starts_with(&dir) {
        return Err("EINVAL: 导出目标不能位于打包源目录内".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        create_from_dir_to(
            &dir.to_string_lossy(),
            &target.to_string_lossy(),
            order.unwrap_or_else(|| vec!["manifest.json".to_string()]),
        )
    })
    .await
    .map_err(|e| format!("EIO: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_base(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        // 不使用系统 temp：该目录在本机测试进程里可能被 ACL 拒绝；target/ 随构建目录可写。
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("test-tmp")
            .join(format!("tpr-zip-{tag}-{}-{nanos}", std::process::id()))
    }

    fn write_source(src: &Path) {
        fs::create_dir_all(src.join("articles")).unwrap();
        fs::write(src.join("manifest.json"), b"{}").unwrap();
        fs::write(src.join("articles/a.json"), b"{\"id\":\"a\"}").unwrap();
    }

    #[test]
    fn create_from_dir_to_writes_and_replaces_target() {
        let base = temp_base("replace");
        let src = base.join("src");
        write_source(&src);
        let target = base.join("out.tpr");
        fs::write(&target, b"old").unwrap();

        let result = create_from_dir_to(
            &src.to_string_lossy(),
            &target.to_string_lossy(),
            vec!["manifest.json".to_string()],
        )
        .unwrap();
        assert_eq!(result["entries"].as_u64(), Some(2));
        assert!(!base.join("out.tpr.partial").exists());

        let file = File::open(&target).unwrap();
        let mut archive = ZipArchive::new(file).unwrap();
        assert_eq!(archive.len(), 2);
        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().unwrap().to_string())
            .collect();
        assert!(names.contains(&"manifest.json".to_string()));
        assert!(names.contains(&"articles/a.json".to_string()));
        drop(archive);
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn create_from_dir_to_cleans_partial_when_replace_fails() {
        let base = temp_base("failure");
        let src = base.join("src");
        write_source(&src);
        let target = base.join("out.tpr");
        // 目标已存在且是目录：rename 必然失败；helper 必须删掉 partial，保留目标。
        fs::create_dir_all(&target).unwrap();

        let result = create_from_dir_to(
            &src.to_string_lossy(),
            &target.to_string_lossy(),
            vec!["manifest.json".to_string()],
        );
        assert!(result.is_err());
        assert!(target.is_dir());
        assert!(!base.join("out.tpr.partial").exists());
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn resolve_export_target_rejects_non_tpr_and_missing_parent() {
        let base = temp_base("target");
        fs::create_dir_all(&base).unwrap();
        assert!(resolve_export_target(&base.join("out.zip").to_string_lossy()).is_err());
        assert!(resolve_export_target(&base.join("missing/out.tpr").to_string_lossy()).is_err());
        let resolved = resolve_export_target(&base.join("out.tpr").to_string_lossy()).unwrap();
        assert_eq!(resolved.file_name().unwrap(), "out.tpr");
        fs::remove_dir_all(&base).ok();
    }
}
