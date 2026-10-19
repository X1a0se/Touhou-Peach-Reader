import type { Platform } from '@tpr/platform';
import type { RawDatabase } from '@tpr/schema';
import { createContentStore, type ContentStore } from './content-store.js';
import { exportDatabase, type ExportResult, type ExportSelection } from './export.js';
import type { ImportOutcome } from './import.js';
import { importDatabaseFromBytes, importDatabaseFromPath } from './import.js';
import { normalizeDatabase } from './normalize.js';
import { readDatabaseDir } from './read.js';
import { toSnapshot, type DBSnapshot } from './snapshot.js';
import { ioFor } from './workspace.js';
import { readActive, workspacePath } from './workspace.js';

export interface LoadedDatabase {
  readonly databaseId: string;
  readonly dir: string;
  readonly db: RawDatabase;
  readonly contents: ContentStore;
}

export interface Library {
  /** 当前内存中的库；未加载时为 null。 */
  current(): LoadedDatabase | null;
  snapshot(): DBSnapshot | null;
  /** 从 `active.json` 指向的 workspace 目录重新载入（启动时调用）。 */
  restore(): Promise<DBSnapshot | null>;
  importBytes(bytes: Uint8Array): Promise<ImportOutcome>;
  importZip(zipPath: string): Promise<ImportOutcome>;
  export(selection: ExportSelection): Promise<ExportResult>;
  readContent(articleId: string): Promise<string>;
  saveContent(articleId: string, markdown: string): Promise<void>;
}

/**
 * 库服务：把 disk 上的 workspace 目录当作唯一真相（design §9.1）。
 * 导入完成后一律重新从磁盘读，这样"导入 → 重启 → 数据还在"天然被覆盖。
 */
export function createLibrary(platform: Platform): Library {
  let loaded: LoadedDatabase | null = null;

  async function loadFrom(dir: string, databaseId: string): Promise<LoadedDatabase> {
    const io = ioFor(platform);
    const raw = await readDatabaseDir(io, dir);
    const { db } = normalizeDatabase(raw);
    loaded = {
      databaseId,
      dir,
      db,
      contents: createContentStore(io, dir),
    };
    return loaded;
  }

  return {
    current: () => loaded,

    snapshot: () => (loaded ? toSnapshot(loaded.db) : null),

    async restore(): Promise<DBSnapshot | null> {
      const active = await readActive(platform);
      if (!active) return null;
      const dir = workspacePath(platform, active.databaseId);
      if (!(await platform.fs.exists(dir))) return null;
      const db = await loadFrom(dir, active.databaseId);
      return toSnapshot(db.db);
    },

    async importBytes(bytes: Uint8Array): Promise<ImportOutcome> {
      const outcome = await importDatabaseFromBytes(platform, bytes);
      await loadFrom(workspacePath(platform, outcome.snapshot.manifest.databaseId), outcome.snapshot.manifest.databaseId);
      return outcome;
    },

    async importZip(zipPath: string): Promise<ImportOutcome> {
      const outcome = await importDatabaseFromPath(platform, zipPath);
      await loadFrom(workspacePath(platform, outcome.snapshot.manifest.databaseId), outcome.snapshot.manifest.databaseId);
      return outcome;
    },

    async export(selection: ExportSelection): Promise<ExportResult> {
      if (!loaded) throw new Error('尚未打开数据库，无法导出');
      return exportDatabase(
        platform,
        { dir: loaded.dir, db: loaded.db, contents: loaded.contents },
        selection,
      );
    },

    async readContent(articleId: string): Promise<string> {
      if (!loaded) throw new Error('尚未打开数据库');
      return loaded.contents.read(articleId);
    },

    async saveContent(articleId: string, markdown: string): Promise<void> {
      if (!loaded) throw new Error('尚未打开数据库');
      await loaded.contents.write(articleId, markdown);
    },
  };
}
