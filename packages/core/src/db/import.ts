import type { Platform, RejectedEntry } from '@tpr/platform';
import {
  type RawDatabase,
  type ValidateResult,
  migrateDatabase,
  validateDatabase,
} from '@tpr/schema';
import { computeCounts, normalizeDatabase } from './normalize.js';
import { readDatabaseDir } from './read.js';
import { toSnapshot, type DBSnapshot } from './snapshot.js';
import { DB_LAYOUT, commitWorkspace, ioFor, removeTree } from './workspace.js';
import { serializeDatabase, writeDatabaseDir } from './write.js';

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
    const ready: RawDatabase = {
      ...normalized,
      manifest: { ...normalized.manifest, counts: computeCounts(normalized), updatedAt: normalized.manifest.updatedAt },
    };

    const report = validateDatabase(ready);
    if (!report.ok) {
      throw new ImportError(`导入失败：数据库校验未通过（${report.errors.length} 个错误）`, report);
    }

    // 归一化后的文本重新落盘（正文写成 .md），图片已由解压阶段就位
    await writeDatabaseDir(io, staging, serializeDatabase(ready, markdown));
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
