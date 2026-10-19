import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, UnsupportedSchemaError, migrateDatabase } from '../src/migrate.js';
import { makeDatabase } from '../src/testing/index.js';
import type { RawDatabase } from '../src/raw.js';

describe('migrateDatabase', () => {
  it('当前版本是恒等迁移，并记录 applied', () => {
    const db = makeDatabase();
    const { db: migrated, applied } = migrateDatabase(db, CURRENT_SCHEMA_VERSION);
    expect(applied).toEqual([CURRENT_SCHEMA_VERSION]);
    expect(migrated).toEqual(db);
  });

  it('更高版本抛 E_NEWER_SCHEMA，并给出可读中文', () => {
    const db = makeDatabase();
    try {
      migrateDatabase(db, CURRENT_SCHEMA_VERSION + 1);
      throw new Error('应当抛错');
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedSchemaError);
      const e = error as UnsupportedSchemaError;
      expect(e.code).toBe('E_NEWER_SCHEMA');
      expect(e.message).toContain('升级客户端');
    }
  });

  it('未知版本抛 E_UNKNOWN_SCHEMA', () => {
    const db = makeDatabase();
    expect(() => migrateDatabase(db, 0)).toThrowError(UnsupportedSchemaError);
  });

  it('注入的 v2 迁移会按序执行', () => {
    const db = makeDatabase();
    const v2 = (raw: RawDatabase): RawDatabase => ({
      ...raw,
      manifest: { ...raw.manifest, version: '2.0.0' },
    });
    const { db: migrated, applied } = migrateDatabase(db, 1, { 1: (r) => r, 2: v2 }, 2);
    expect(applied).toEqual([2]);
    expect(migrated.manifest.version).toBe('2.0.0');
  });
});
