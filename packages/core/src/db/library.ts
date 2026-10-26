import type { Platform } from '@tpr/platform';
import { type RawDatabase, validateDatabase } from '@tpr/schema';
import { createContentStore, type ContentStore } from './content-store.js';
import {
  exportDatabase,
  exportDatabaseToPath,
  type ExportResult,
  type ExportSelection,
  type ExportSummary,
} from './export.js';
import type { ImportOutcome } from './import.js';
import { importDatabaseFromBytes, importDatabaseFromPath } from './import.js';
import { ensureLocalDatabase } from './migrate.js';
import { computeCounts } from './normalize.js';
import { databasePathOf, readSqliteFromFile, saveDatabase } from './sql/store.js';
import { toSnapshot, type DBSnapshot } from './snapshot.js';
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
  /** 桌面端：直接写到用户选定的路径，ZIP 字节不回传 JS。 */
  exportToPath(selection: ExportSelection, targetPath: string): Promise<ExportSummary>;
  readContent(articleId: string): Promise<string>;
  saveContent(articleId: string, markdown: string): Promise<void>;
  /** 每次从磁盘载入或写完正文都 +1；搜索索引靠它判断是否需要重建。 */
  readonly revision: number;
  /**
   * 编辑器专用：在结构化克隆出来的草稿上改，校验通过才替换内存态并整体落盘。
   * 所有写入串行执行，避免快速连点造成 SQLite 事务交错（design §9.5）。
   */
  applyEdit(build: (draft: RawDatabase) => void): Promise<void>;
  /**
   * 只改显示用的 `manifest.name`（数据库包名），与 applyEdit 共用校验与落盘路径。
   * 不改变 databaseId、目录结构或任何实体数据。
   */
  rename(name: string): Promise<void>;
}

/**
 * 库服务：把 disk 上的 workspace 目录当作唯一真相（design §9.1）。
 * 导入完成后一律重新从磁盘读，这样"导入 → 重启 → 数据还在"天然被覆盖。
 */
export function createLibrary(platform: Platform): Library {
  let loaded: LoadedDatabase | null = null;
  let revision = 0;
  let writeQueue: Promise<void> = Promise.resolve();

  async function loadFrom(dir: string, databaseId: string): Promise<LoadedDatabase> {
    await ensureLocalDatabase(platform, dir);
    const dbPath = databasePathOf(platform, dir);
    const db = await readSqliteFromFile(platform, dbPath);
    loaded = {
      databaseId,
      dir,
      db,
      contents: createContentStore(platform, dbPath),
    };
    revision += 1;
    return loaded;
  }

  /** 在草稿上改、校验，再用差异事务写回 SQLite；所有写操作共用同一条队列。 */
  async function persist(build: (draft: RawDatabase) => void): Promise<void> {
    const current = loaded;
    if (!current) throw new Error('尚未打开数据库，无法编辑');
    const draft = structuredClone(current.db);
    build(draft);
    draft.manifest.updatedAt = new Date().toISOString();
    // computeCounts 返回新对象（不改入参），必须回写，否则首页计数永远停在导入时的值
    draft.manifest.counts = computeCounts(draft);
    // SQLite 路径下没有独立文件可校验；正文行由 content store 保证，图片字节由编辑器/合并写入。
    delete draft.filePaths;
    const report = validateDatabase(draft);
    const error = report.errors[0];
    if (error) throw new Error(`${error.code}: ${error.message}`);

    // 正文独立存表：没有行的文章先补空行，编辑后删除的文章由差异事务清掉。
    for (const article of draft.articles) {
      if (!(await current.contents.has(article.id))) await current.contents.write(article.id, '');
    }
    await saveDatabase(platform, current.dir, current.db, draft);

    const nextIds = new Set(draft.articles.map((article) => article.id));
    for (const article of current.db.articles) {
      if (!nextIds.has(article.id)) current.contents.invalidate(article.id);
    }
    current.db.manifest.counts = draft.manifest.counts;
    // 改名也必须回写，否则 snapshot 与首页仍显示旧名
    current.db.manifest.name = draft.manifest.name;
    Object.assign(current.db, {
      authors: draft.authors,
      tags: draft.tags,
      images: draft.images,
      articles: draft.articles,
      series: draft.series,
      featured: draft.featured,
      credits: draft.credits,
    });
    current.db.manifest.updatedAt = draft.manifest.updatedAt;
    current.db.filePaths = new Set([
      ...draft.articles.map((article) =>
        typeof article.content === 'object' && article.content !== null ? article.content.file : '',
      ).filter((file) => file.length > 0),
      ...draft.images.map((image) => image.file),
    ]);
    revision += 1;
  }

  /** 所有写操作串行入队，避免快速连点造成 SQLite 事务交错（design §9.5）。 */
  function enqueueEdit(build: (draft: RawDatabase) => void): Promise<void> {
    const run = (): Promise<void> => persist(build);
    return writeQueue.then(run, run);
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

    async exportToPath(selection: ExportSelection, targetPath: string): Promise<ExportSummary> {
      if (!loaded) throw new Error('尚未打开数据库，无法导出');
      return exportDatabaseToPath(
        platform,
        { dir: loaded.dir, db: loaded.db, contents: loaded.contents },
        selection,
        targetPath,
      );
    },

    async readContent(articleId: string): Promise<string> {
      if (!loaded) throw new Error('尚未打开数据库');
      return loaded.contents.read(articleId);
    },

    async saveContent(articleId: string, markdown: string): Promise<void> {
      if (!loaded) throw new Error('尚未打开数据库');
      await loaded.contents.write(articleId, markdown);
      revision += 1;
    },

    get revision() {
      return revision;
    },

    applyEdit(build) {
      return enqueueEdit(build);
    },

    async rename(name) {
      const trimmed = name.trim();
      if (trimmed.length === 0) throw new Error('数据库名称不能为空');
      if (trimmed.length > 200) throw new Error('数据库名称不能超过 200 个字符');
      await enqueueEdit((draft) => {
        draft.manifest.name = trimmed;
      });
    },
  };
}
