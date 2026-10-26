//! SQLite 命令与图片协议（本地数据库）。
//!
//! 所有路径都先过 `fs::resolve*`，与文件命令一样限制在 app data 目录内。
//! SQL 查询只返回 null/整数/浮点/文本；图片 BLOB 走专用二进制命令与自定义协议。

use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::types::ValueRef;
use rusqlite::{params_from_iter, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use tauri::http::header::{CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE};
use tauri::http::StatusCode;
use tauri::{AppHandle, Manager};

use super::fs::{resolve, resolve_for_write};

#[derive(Deserialize)]
pub struct SqlStatement {
    sql: String,
    #[serde(default)]
    params: Vec<serde_json::Value>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum SqlCell {
    Null,
    Integer(i64),
    Real(f64),
    Text(String),
}

fn sql_err(error: rusqlite::Error) -> String {
    format!("EIO: SQLite 操作失败：{error}")
}

/// SQLite 的 Windows VFS 不接受 Rust canonicalize 产生的 \\?\ 前缀，传给 SQLite 前先还原成普通路径。
fn sqlite_path(path: &Path) -> PathBuf {
    let text = path.as_os_str().to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path.to_path_buf()
}

fn open_connection(path: &Path, create: bool) -> Result<Connection, String> {
    let path = sqlite_path(path);
    if !create && !path.exists() {
        return Err(format!("ENOENT: 数据库不存在：{}", path.display()));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("EIO: {e}"))?;
    }
    let connection = Connection::open(&path).map_err(sql_err)?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(sql_err)?;
    Ok(connection)
}

fn bind_value(value: &serde_json::Value) -> Result<rusqlite::types::Value, String> {
    match value {
        serde_json::Value::Null => Ok(rusqlite::types::Value::Null),
        serde_json::Value::Bool(flag) => Ok(rusqlite::types::Value::Integer(if *flag { 1 } else { 0 })),
        serde_json::Value::Number(number) => {
            if let Some(integer) = number.as_i64() {
                Ok(rusqlite::types::Value::Integer(integer))
            } else if let Some(real) = number.as_f64() {
                Ok(rusqlite::types::Value::Real(real))
            } else {
                Err(format!("EINVAL: 不支持的 SQL 数字参数：{number}"))
            }
        }
        serde_json::Value::String(text) => Ok(rusqlite::types::Value::Text(text.clone())),
        other => Err(format!("EINVAL: 不支持的 SQL 参数类型：{other}")),
    }
}

fn bind_params(params: &[serde_json::Value]) -> Result<Vec<rusqlite::types::Value>, String> {
    params.iter().map(bind_value).collect()
}

fn cell_of(value: ValueRef<'_>) -> Result<SqlCell, String> {
    match value {
        ValueRef::Null => Ok(SqlCell::Null),
        ValueRef::Integer(integer) => Ok(SqlCell::Integer(integer)),
        ValueRef::Real(real) => Ok(SqlCell::Real(real)),
        ValueRef::Text(bytes) => std::str::from_utf8(bytes)
            .map(|text| SqlCell::Text(text.to_string()))
            .map_err(|e| format!("EIO: SQL 文本不是合法 UTF-8：{e}")),
        ValueRef::Blob(_) => Err("EIO: SQL 查询不能返回 BLOB".to_string()),
    }
}

/// 普通查询：结果只允许 null / 整数 / 浮点 / 文本。
#[tauri::command]
pub async fn sql_query(
    app: AppHandle,
    path: String,
    sql: String,
    params: Vec<serde_json::Value>,
) -> Result<Vec<serde_json::Map<String, serde_json::Value>>, String> {
    let path = resolve(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let connection = open_connection(&path, false)?;
        let mut statement = connection.prepare(&sql).map_err(sql_err)?;
        let names: Vec<String> = statement
            .column_names()
            .into_iter()
            .map(|name| name.to_string())
            .collect();
        let values = bind_params(&params)?;
        let mut rows = statement.query(params_from_iter(values)).map_err(sql_err)?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(sql_err)? {
            let mut record = serde_json::Map::with_capacity(names.len());
            for (index, name) in names.iter().enumerate() {
                let value = row.get_ref(index).map_err(sql_err)?;
                let cell = cell_of(value)?;
                let json = serde_json::to_value(cell).map_err(|e| format!("EIO: {e}"))?;
                record.insert(name.clone(), json);
            }
            out.push(record);
        }
        Ok(out)
    })
    .await
    .map_err(|e| format!("EIO: {e}"))?
}

/// 批量写入：所有语句在同一个事务里执行。
#[tauri::command]
pub async fn sql_batch(
    app: AppHandle,
    path: String,
    statements: Vec<SqlStatement>,
) -> Result<(), String> {
    let path = resolve_for_write(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut connection = open_connection(&path, true)?;
        let transaction = connection.transaction().map_err(sql_err)?;
        for statement in statements {
            let values = bind_params(&statement.params)?;
            let mut prepared = transaction.prepare(&statement.sql).map_err(sql_err)?;
            prepared
                .execute(params_from_iter(values))
                .map_err(sql_err)?;
        }
        transaction.commit().map_err(sql_err)
    })
    .await
    .map_err(|e| format!("EIO: {e}"))?
}

/// 读取单张图片的 BLOB；没有匹配行时返回空字节，TS 侧映射为 null。
#[tauri::command]
pub async fn sql_read_blob(
    app: AppHandle,
    path: String,
    sql: String,
    params: Vec<serde_json::Value>,
) -> Result<tauri::ipc::Response, String> {
    let path = resolve(&app, &path)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let connection = open_connection(&path, false)?;
        let mut statement = connection.prepare(&sql).map_err(sql_err)?;
        let values = bind_params(&params)?;
        let mut rows = statement.query(params_from_iter(values)).map_err(sql_err)?;
        if let Some(row) = rows.next().map_err(sql_err)? {
            row.get::<_, Vec<u8>>(0).map_err(sql_err)
        } else {
            Ok(Vec::new())
        }
    })
    .await
    .map_err(|e| format!("EIO: {e}"))??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// 把 BLOB 直接写到目标文件（导出时避免图片字节穿过 JS）。
#[tauri::command]
pub async fn sql_read_blob_to_file(
    app: AppHandle,
    path: String,
    sql: String,
    params: Vec<serde_json::Value>,
    target_path: String,
) -> Result<bool, String> {
    let path = resolve(&app, &path)?;
    let target = resolve_for_write(&app, &target_path)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
        let connection = open_connection(&path, false)?;
        let mut statement = connection.prepare(&sql).map_err(sql_err)?;
        let values = bind_params(&params)?;
        let mut rows = statement.query(params_from_iter(values)).map_err(sql_err)?;
        let Some(row) = rows.next().map_err(sql_err)? else {
            return Ok(false);
        };
        let bytes = row.get::<_, Vec<u8>>(0).map_err(sql_err)?;
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("EIO: {e}"))?;
        }
        std::fs::write(&target, bytes).map_err(|e| format!("EIO: {e}"))?;
        Ok(true)
    })
    .await
    .map_err(|e| format!("EIO: {e}"))?
}

/// 把字节或 app data 内的文件作为最后一个占位符绑定为 BLOB。
#[tauri::command]
pub async fn sql_write_blob(
    app: AppHandle,
    path: String,
    sql: String,
    params: Vec<serde_json::Value>,
    bytes: Option<Vec<u8>>,
    source_path: Option<String>,
) -> Result<(), String> {
    let path = resolve_for_write(&app, &path)?;
    let source = match (bytes, source_path) {
        (Some(bytes), _) => Some(bytes),
        (None, Some(source_path)) => {
            let source = resolve(&app, &source_path)?;
            Some(std::fs::read(&source).map_err(|e| format!("EIO: {e}"))?)
        }
        (None, None) => None,
    };
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let mut connection = open_connection(&path, true)?;
        let transaction = connection.transaction().map_err(sql_err)?;
        let values = bind_params(&params)?;
        let mut prepared = transaction.prepare(&sql).map_err(sql_err)?;
        match source {
            Some(bytes) => {
                prepared
                    .execute(rusqlite::params_from_iter(
                        values.into_iter().chain(std::iter::once(
                            rusqlite::types::Value::Blob(bytes),
                        )),
                    ))
                    .map_err(sql_err)?;
            }
            None => {
                return Err("EINVAL: 缺少 BLOB 来源（bytes 或 sourcePath）".to_string());
            }
        }
        drop(prepared);
        transaction.commit().map_err(sql_err)
    })
    .await
    .map_err(|e| format!("EIO: {e}"))?
}

fn safe_segment(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn find_database<R: tauri::Runtime>(app: &AppHandle<R>, database_id: &str) -> Result<PathBuf, String> {
    if !safe_segment(database_id) {
        return Err("EINVAL: 非法的数据库 id".to_string());
    }
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("EIO: 无法定位 app data 目录：{e}"))?;
    let root = data.join("workspace");
    let db = root.join(database_id).join("database.sqlite");
    let db = db
        .canonicalize()
        .map_err(|_| "ENOENT: 数据库不存在".to_string())?;
    let root = root.canonicalize().map_err(|e| format!("EIO: {e}"))?;
    if !db.starts_with(&root) {
        return Err("EACCES: 数据库路径越界".to_string());
    }
    Ok(db)
}

fn mime_of(value: Option<String>) -> String {
    match value {
        Some(mime)
            if mime.starts_with("image/")
                && mime.len() <= 100
                && mime.chars().all(|c| c.is_ascii_graphic()) =>
        {
            mime
        }
        _ => "application/octet-stream".to_string(),
    }
}

fn protocol_error(status: StatusCode, message: &str) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(CACHE_CONTROL, "no-store")
        .body(message.as_bytes().to_vec())
        .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
}

/// 自定义协议：`/image/{databaseId}/{imageId}` 从 database.sqlite 读取图片 BLOB。
pub fn image_response<R: tauri::Runtime>(
    app: &AppHandle<R>,
    uri: &tauri::http::Uri,
) -> tauri::http::Response<Vec<u8>> {
    let segments: Vec<&str> = uri.path().trim_matches('/').split('/').collect();
    if segments.len() != 3 || segments[0] != "image" {
        return protocol_error(StatusCode::BAD_REQUEST, "无效的图片地址");
    }
    let database_id = segments[1];
    let image_id = segments[2];
    if !safe_segment(database_id) || !safe_segment(image_id) {
        return protocol_error(StatusCode::BAD_REQUEST, "无效的图片地址");
    }

    let db = match find_database(app, database_id) {
        Ok(path) => sqlite_path(&path),
        Err(_) => return protocol_error(StatusCode::NOT_FOUND, "图片不存在"),
    };
    let result = (|| -> Result<(Vec<u8>, String), String> {
        let connection = Connection::open_with_flags(&db, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(sql_err)?;
        connection.busy_timeout(Duration::from_secs(5)).map_err(sql_err)?;
        let mut statement = connection
            .prepare("SELECT data, mime FROM images WHERE id = ?1")
            .map_err(sql_err)?;
        let mut rows = statement.query([image_id]).map_err(sql_err)?;
        let Some(row) = rows.next().map_err(sql_err)? else {
            return Err("ENOENT: 图片不存在".to_string());
        };
        let bytes = row.get::<_, Vec<u8>>(0).map_err(sql_err)?;
        let mime = mime_of(row.get::<_, Option<String>>(1).map_err(sql_err)?);
        Ok((bytes, mime))
    })();

    match result {
        Ok((bytes, mime)) => tauri::http::Response::builder()
            .status(StatusCode::OK)
            .header(CONTENT_TYPE, mime)
            .header(CONTENT_LENGTH, bytes.len().to_string())
            .header(CACHE_CONTROL, "no-store")
            .body(bytes)
            .unwrap_or_else(|_| protocol_error(StatusCode::INTERNAL_SERVER_ERROR, "图片读取失败")),
        Err(_) => protocol_error(StatusCode::NOT_FOUND, "图片不存在"),
    }
}

#[cfg(test)]
mod sqlite_path_tests {
    use super::sqlite_path;
    use std::path::{Path, PathBuf};

    #[test]
    fn strips_windows_verbatim_prefix() {
        assert_eq!(
            sqlite_path(Path::new(r"\\?\C:\Temp\a.sqlite")),
            PathBuf::from(r"C:\Temp\a.sqlite")
        );
        assert_eq!(
            sqlite_path(Path::new(r"\\?\UNC\server\share\a.sqlite")),
            PathBuf::from(r"\\server\share\a.sqlite")
        );
        assert_eq!(
            sqlite_path(Path::new(r"C:\Temp\a.sqlite")),
            PathBuf::from(r"C:\Temp\a.sqlite")
        );
    }
}
