import type { RawDatabase } from './raw.js';

/**
 * schemaVersion 迁移（design §8）。
 *
 * 顺序不可换：先迁移（改形状）→ 再 zod 解析（类型）→ 再语义校验。
 */

export const CURRENT_SCHEMA_VERSION = 1 as const;

/** 迁移函数操作"未解析"的原始形状，key = 迁移完成后到达的版本号 */
export type Migration = (raw: RawDatabase) => RawDatabase;

export const MIGRATIONS: Record<number, Migration> = {
  // v1 恒等迁移：把机制跑通；未来追加 2、3……
  1: (raw) => raw,
};

export type UnsupportedSchemaCode = 'E_NEWER_SCHEMA' | 'E_UNKNOWN_SCHEMA';

export class UnsupportedSchemaError extends Error {
  constructor(
    readonly code: UnsupportedSchemaCode,
    readonly version: number,
  ) {
    super(
      code === 'E_NEWER_SCHEMA'
        ? `该数据库由更新版本的“东方桃图吧大书库”创建（schemaVersion=${version}），请先升级客户端。`
        : `无法识别的 schemaVersion=${version}。`,
    );
    this.name = 'UnsupportedSchemaError';
  }
}

export function migrateDatabase(
  raw: RawDatabase,
  fromVersion: number,
  registry: Record<number, Migration> = MIGRATIONS,
  currentVersion: number = CURRENT_SCHEMA_VERSION,
): { db: RawDatabase; applied: number[] } {
  if (!Number.isInteger(fromVersion) || fromVersion < 1) {
    throw new UnsupportedSchemaError('E_UNKNOWN_SCHEMA', fromVersion);
  }
  if (fromVersion > currentVersion) {
    throw new UnsupportedSchemaError('E_NEWER_SCHEMA', fromVersion);
  }

  let db = raw;
  const applied: number[] = [];
  for (let v = fromVersion + 1; v <= currentVersion; v += 1) {
    const migration = registry[v];
    if (!migration) throw new UnsupportedSchemaError('E_UNKNOWN_SCHEMA', v);
    db = migration(db);
    applied.push(v);
  }
  if (fromVersion === currentVersion) applied.push(currentVersion);
  return { db, applied };
}
