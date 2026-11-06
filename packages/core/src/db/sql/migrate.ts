import { PlatformError, type Platform, type SqlStatement } from '@tpr/platform';
import { rowInt, rowText } from './codec.js';
import { SQL_SCHEMA_VERSION } from './schema.js';

/** v1 → v2 新增 updated_at 的表；全部允许为空，旧数据读出来就是“没有修改时间”。 */
const UPDATED_AT_TABLES = ['authors', 'tags', 'images', 'featured'] as const;

/** v2 → v3：系列插图（与文章插图同构，仅多一张子表）。 */
const SERIES_ILLUSTRATIONS_DDL = `CREATE TABLE IF NOT EXISTS series_illustrations (
  series_id TEXT NOT NULL,
  image_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (series_id, position)
)`;

async function columnNames(platform: Platform, dbPath: string, table: string): Promise<Set<string>> {
  const rows = await platform.sql.query(dbPath, `SELECT name FROM pragma_table_info('${table}')`);
  return new Set(rows.map((row) => rowText(row, 'name')));
}

/**
 * 把本地 SQLite 从旧布局升级到当前布局。
 *
 * 只在文件已存在时工作；缺失文件由 migrateLegacyWorkspace 负责创建。
 * user_version 是唯一权威：新库直接是 3，v1 旧库补 updated_at，v2 旧库补系列插图。
 * 所有 ALTER 与版本写入放在同一个 batch（单事务）里，中断后下次仍从旧版本重试，天然幂等。
 */
export async function migrateSqlSchema(platform: Platform, dbPath: string): Promise<void> {
  if (!(await platform.fs.exists(dbPath))) return;

  const versionRows = await platform.sql.query(dbPath, 'PRAGMA user_version');
  const version = versionRows[0] ? rowInt(versionRows[0], 'user_version') : 0;
  if (version === SQL_SCHEMA_VERSION) return;
  if (version < 1 || version > SQL_SCHEMA_VERSION) {
    throw new PlatformError('EIO', `不支持的本地数据库版本：${version}`);
  }

  const statements: SqlStatement[] = [];
  if (version < 2) {
    for (const table of UPDATED_AT_TABLES) {
      const columns = await columnNames(platform, dbPath, table);
      if (!columns.has('updated_at')) {
        statements.push({ sql: `ALTER TABLE ${table} ADD COLUMN updated_at TEXT` });
      }
    }
  }
  if (version < 3) {
    const seriesColumns = await columnNames(platform, dbPath, 'series');
    if (!seriesColumns.has('illustration_ids_present')) {
      statements.push({
        sql: 'ALTER TABLE series ADD COLUMN illustration_ids_present INTEGER NOT NULL DEFAULT 0',
      });
    }
    statements.push({ sql: SERIES_ILLUSTRATIONS_DDL });
    statements.push({
      sql: 'CREATE INDEX IF NOT EXISTS idx_series_illustrations_series ON series_illustrations(series_id)',
    });
  }
  statements.push({ sql: `PRAGMA user_version = ${SQL_SCHEMA_VERSION}` });
  await platform.sql.batch(dbPath, statements);
}
