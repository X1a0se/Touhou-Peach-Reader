import type { Platform, RejectedEntry } from '@tpr/platform';
import {
  type RawDatabase,
  type ValidateResult,
  migrateDatabase,
  validateDatabase,
} from '@tpr/schema';
import { articleMd } from './layout.js';
import { computeCounts, normalizeDatabase } from './normalize.js';
import { readDatabaseDir } from './read.js';
import { toSnapshot, type DBSnapshot } from './snapshot.js';
import { databasePathOf, writeSqliteDatabase } from './sql/store.js';
import { DB_LAYOUT, commitWorkspace, ioFor, removeTree } from './workspace.js';

export interface ImportOutcome {
  snapshot: DBSnapshot;
  report: ValidateResult;
  migrations: number[];
  rejected: RejectedEntry[];
}

export class ImportError extends Error {
  constructor(
    message: string,
    readonly report: ValidateResult,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

async function runImport(
  platform: Platform,
  zipPath: string,
  stamp: number,
  cleanupZip: boolean,
): Promise<ImportOutcome> {
  const io = ioFor(platform);
  const staging = platform.paths.join(platform.paths.dataDir, DB_LAYOUT.importsDir, String(stamp));
  const extracted = await platform.zip.extractAll(zipPath, staging);

  try {
    const raw = await readDatabaseDir(io, staging);
    const { db: migrated, applied } = migrateDatabase(raw, raw.manifest.schemaVersion);
    // 注意：migrate 可能改形状，所以先迁移、再归一化正文、最后校验
    const { db: normalized, markdown } = normalizeDatabase(migrated);
    // 内联正文归一化后变成虚拟的 articles/{id}.md，校验前补进文件集合。
    const filePaths = new Set(normalized.filePaths ?? []);
    for (const [id] of markdown) filePaths.add(articleMd(id));
    for (const article of normalized.articles) {
      if (typeof article.content === 'object' && article.content !== null) filePaths.add(article.content.file);
    }
    const ready: RawDatabase = {
      ...normalized,
      manifest: { ...normalized.manifest, counts: computeCounts(normalized), updatedAt: normalized.manifest.updatedAt },
      filePaths,
    };

    const report = validateDatabase(ready);
    if (!report.ok) {
      throw new ImportError(`导入失败：数据库校验未通过（${report.errors.length} 个错误）`, report);
    }

    for (const article of ready.articles) {
      if (markdown.has(article.id)) continue;
      if (typeof article.content !== 'object' || article.content === null) continue;
      markdown.set(article.id, await platform.fs.readText(io.join(staging, article.content.file)));
    }

    // 所有实体、正文与图片 BLOB 一次性写成 staging/database.sqlite；解压出来的
    // JSON/Markdown/图片只是原料，写完即删，提交后的 workspace 只保留 SQLite 文件。
    const imageSources = new Map<string, { file: string }>();
    for (const image of ready.images) imageSources.set(image.id, { file: io.join(staging, image.file) });
    await writeSqliteDatabase(platform, databasePathOf(platform, staging), ready, markdown, imageSources);
    for (const entry of await platform.fs.listDir(staging)) {
      if (entry.name === 'database.sqlite') continue;
      await platform.fs.remove(entry.path, { recursive: true });
    }
    await commitWorkspace(platform, staging, ready.manifest.databaseId);

    return {
      snapshot: toSnapshot(ready),
      report,
      migrations: applied,
      rejected: extracted.rejected,
    };
  } finally {
    await removeTree(platform, staging);
    if (cleanupZip) await removeTree(platform, zipPath);
  }
}

/** `/goal` 3 的字节入口：桌面端把字节落成临时 .tpr，仍然走 Rust 流式解压。 */
export async function importDatabaseFromBytes(platform: Platform, bytes: Uint8Array): Promise<ImportOutcome> {
  const stamp = Date.now();
  const importsRoot = platform.paths.join(platform.paths.dataDir, DB_LAYOUT.importsDir);
  await platform.fs.mkdir(importsRoot);
  const zipPath = platform.paths.join(importsRoot, `${stamp}.tpr`);
  await platform.fs.writeBytes(zipPath, bytes);
  return runImport(platform, zipPath, stamp, true);
}

/** 路径入口：拖入/选择的是用户自己的文件，绝不删除。 */
export async function importDatabaseFromPath(platform: Platform, zipPath: string): Promise<ImportOutcome> {
  return runImport(platform, zipPath, Date.now(), false);
}
