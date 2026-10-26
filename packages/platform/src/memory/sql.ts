/// <reference path="../sql.js.d.ts" />
/// <reference path="../env.d.ts" />
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { PlatformError } from '../errors.js';
import { dirnamePath } from '../paths.js';
import type { BlobSource, IFileSystem, ISql, SqlRow, SqlValue, SqlStatement } from '../types.js';

/**
 * 内存/测试 SQL 实现：完整 SQLite 语义由 sql.js WASM 提供。
 *
 * 每次操作都从文件加载数据库、执行、导出回文件。测试数据量很小；
 * 桌面生产使用 Rust + rusqlite，不会加载这个模块。
 */

interface NodeProcess {
  versions?: { node?: string };
  getBuiltinModule?: (id: string) => unknown;
}

let enginePromise: Promise<SqlJsStatic> | null = null;

async function loadEngine(): Promise<SqlJsStatic> {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    const proc = (globalThis as { process?: NodeProcess }).process;
    if (proc?.versions?.node && typeof proc.getBuiltinModule === 'function') {
      const nodeModule = proc.getBuiltinModule('node:module') as {
        createRequire: (url: string) => { resolve: (id: string) => string };
      };
      const nodeFs = proc.getBuiltinModule('node:fs') as {
        readFileSync: (path: string) => Uint8Array;
      };
      const require = nodeModule.createRequire(import.meta.url);
      const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
      const wasmBinary = nodeFs.readFileSync(wasmPath);
      return initSqlJs({ wasmBinary: wasmBinary as unknown as ArrayBuffer });
    }
    const wasmUrl = (await import('sql.js/dist/sql-wasm.wasm?url')).default;
    return initSqlJs({ locateFile: () => wasmUrl });
  })();
  return enginePromise;
}

function sqlError(error: unknown): PlatformError {
  if (error instanceof PlatformError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new PlatformError('EIO', `SQLite 操作失败：${message}`, error);
}

function wrapParams(params: readonly SqlValue[] | undefined): unknown[] | undefined {
  return params === undefined ? undefined : [...params];
}

function toRow(raw: Record<string, unknown>, allowBlob: boolean): SqlRow {
  const row: SqlRow = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || typeof value === 'number' || typeof value === 'string') {
      row[key] = value;
    } else if (value instanceof Uint8Array) {
      if (!allowBlob) throw new PlatformError('EIO', 'SQL 查询不能返回 BLOB');
    } else if (typeof value === 'boolean') {
      row[key] = value ? 1 : 0;
    } else {
      throw new PlatformError('EIO', `SQL 查询返回了不支持的值类型：${typeof value}`);
    }
  }
  return row;
}

function bytesOf(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
    return Uint8Array.from(value as number[]);
  }
  return null;
}

export function createMemorySql(fs: IFileSystem): ISql {
  async function open(path: string, create: boolean): Promise<{ db: Database; existed: boolean }> {
    const engine = await loadEngine();
    let bytes: Uint8Array | null = null;
    try {
      bytes = await fs.readBytes(path);
    } catch (error) {
      if (!(error instanceof PlatformError) || error.code !== 'ENOENT' || !create) throw error;
    }
    return { db: bytes ? new engine.Database(bytes) : new engine.Database(), existed: bytes !== null };
  }

  async function persist(path: string, db: Database): Promise<void> {
    const bytes = db.export();
    await fs.mkdir(dirnamePath(path));
    await fs.writeBytes(path, bytes);
  }

  async function execQuery(
    path: string,
    sql: string,
    params: readonly SqlValue[] | undefined,
    allowBlob: boolean,
  ): Promise<Record<string, unknown>[]> {
    const { db } = await open(path, false);
    try {
      const statement = db.prepare(sql);
      try {
        const bound = wrapParams(params);
        if (bound) statement.bind(bound);
        const rows: Record<string, unknown>[] = [];
        while (statement.step()) rows.push(statement.getAsObject());
        return allowBlob ? rows : rows.map((row) => toRow(row, false));
      } finally {
        statement.free();
      }
    } finally {
      db.close();
    }
  }

  async function readBlobBytes(
    path: string,
    sql: string,
    params?: readonly SqlValue[],
  ): Promise<Uint8Array | null> {
    const rows = await execQuery(path, sql, params, true);
    const first = rows[0];
    if (!first) return null;
    for (const value of Object.values(first)) {
      const bytes = bytesOf(value);
      if (bytes) return bytes;
    }
    return null;
  }

  return {
    async query(path, sql, params) {
      try {
        return (await execQuery(path, sql, params, false)) as SqlRow[];
      } catch (error) {
        throw sqlError(error);
      }
    },

    async batch(path, statements: SqlStatement[]) {
      let db: Database | null = null;
      try {
        const opened = await open(path, true);
        db = opened.db;
        db.run('BEGIN IMMEDIATE');
        try {
          for (const statement of statements) {
            const params = wrapParams(statement.params);
            if (params) db.run(statement.sql, params);
            else db.run(statement.sql);
          }
          db.run('COMMIT');
        } catch (error) {
          try {
            db.run('ROLLBACK');
          } catch {
            // 事务可能尚未开始，忽略回滚失败
          }
          throw error;
        }
        await persist(path, db);
      } catch (error) {
        throw sqlError(error);
      } finally {
        db?.close();
      }
    },

    async readBlob(path, sql, params) {
      try {
        return await readBlobBytes(path, sql, params);
      } catch (error) {
        throw sqlError(error);
      }
    },

    async readBlobToFile(path, sql, params, targetPath) {
      try {
        const bytes = await readBlobBytes(path, sql, params);
        if (!bytes) return false;
        await fs.mkdir(dirnamePath(targetPath));
        await fs.writeBytes(targetPath, bytes);
        return true;
      } catch (error) {
        throw sqlError(error);
      }
    },

    async writeBlob(path, sql, params, source: BlobSource) {
      let db: Database | null = null;
      try {
        const bytes = source instanceof Uint8Array ? source : await fs.readBytes(source.file);
        const opened = await open(path, true);
        db = opened.db;
        db.run('BEGIN IMMEDIATE');
        try {
          db.run(sql, [...params, bytes] as unknown[]);
          db.run('COMMIT');
        } catch (error) {
          try {
            db.run('ROLLBACK');
          } catch {
            // 忽略
          }
          throw error;
        }
        await persist(path, db);
      } catch (error) {
        throw sqlError(error);
      } finally {
        db?.close();
      }
    },
  };
}
