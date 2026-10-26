import { PlatformError, type BlobSource, type Platform } from '@tpr/platform';
import { migrateDatabase, validateDatabase, type RawDatabase } from '@tpr/schema';
import { articleMd, LAYOUT } from './layout.js';
import { computeCounts, normalizeDatabase } from './normalize.js';
import { readDatabaseDir } from './read.js';
import { databasePathOf, writeSqliteDatabase } from './sql/store.js';
import { ioFor } from './workspace.js';

/** 迁移完成后移入 legacy/ 的旧格式根条目；不删除，留作人工备份。 */
const LEGACY_ENTRIES = [
  LAYOUT.manifest,
  LAYOUT.authors,
  LAYOUT.tags,
  LAYOUT.images,
  LAYOUT.featured,
  LAYOUT.credits,
  LAYOUT.articlesDir,
  LAYOUT.seriesDir,
  LAYOUT.imagesDir,
  '.dirty',
] as const;

function migrationPathOf(platform: Platform, dir: string): string {
  return platform.paths.join(dir, `${LAYOUT.database}.migrating`);
}

async function removeIfExists(platform: Platform, path: string, recursive = false): Promise<void> {
  if (await platform.fs.exists(path)) await platform.fs.remove(path, { recursive });
}

/**
 * 把旧版 JSON + Markdown + 图片文件的 workspace 一次性转成 database.sqlite。
 *
 * 顺序保证崩溃安全：
 * 1. 完整写到同目录的 database.sqlite.migrating（内部已验证）；
 * 2. 原子改名为 database.sqlite；
 * 3. 才把旧根条目移进 legacy/。
 * 任一步失败旧数据都还在；半成品 .migrating 下次启动会丢弃重来。
 */
export async function migrateLegacyWorkspace(platform: Platform, dir: string): Promise<boolean> {
  const dbPath = databasePathOf(platform, dir);
  if (await platform.fs.exists(dbPath)) {
    await cleanupLegacyFiles(platform, dir);
    return false;
  }
  if (!(await platform.fs.exists(platform.paths.join(dir, LAYOUT.manifest)))) {
    throw new PlatformError('EIO', `不是有效的数据库目录：缺少 ${LAYOUT.manifest}`);
  }

  const io = ioFor(platform);
  const raw = await readDatabaseDir(io, dir);
  const migrated = migrateDatabase(raw, raw.manifest.schemaVersion).db;
  const normalized = normalizeDatabase(migrated);
  const db = normalized.db;

  // normalize 后正文统一为 { file }；旧包里若直接内联字符串，文件集合里要补上虚拟的 .md。
  const filePaths = new Set(db.filePaths ?? []);
  for (const [id] of normalized.markdown) filePaths.add(articleMd(id));
  for (const article of db.articles) {
    if (typeof article.content === 'object' && article.content !== null) filePaths.add(article.content.file);
  }
  const candidate: RawDatabase = {
    ...db,
    manifest: { ...db.manifest, counts: computeCounts(db) },
    filePaths,
  };
  const report = validateDatabase(candidate);
  if (!report.ok) {
    const detail = report.errors.map((error) => `${error.code}: ${error.message}`).join('；');
    throw new PlatformError('EIO', `旧数据库迁移失败：${detail}`);
  }

  const markdown = new Map(normalized.markdown);
  for (const article of candidate.articles) {
    if (markdown.has(article.id)) continue;
    if (typeof article.content !== 'object' || article.content === null) continue;
    try {
      markdown.set(article.id, await platform.fs.readText(io.join(dir, article.content.file)));
    } catch (error) {
      throw new PlatformError('EIO', `旧数据库正文缺失：${article.content.file}`, error);
    }
  }

  const imageSources = new Map<string, BlobSource>();
  for (const image of candidate.images) {
    imageSources.set(image.id, { file: io.join(dir, image.file) });
  }

  const tempPath = migrationPathOf(platform, dir);
  // 上次迁移可能中断在任一阶段；SQL 文件不存在时旧数据仍在，半成品直接丢弃重来。
  await removeIfExists(platform, tempPath, true);
  try {
    await writeSqliteDatabase(platform, tempPath, candidate, markdown, imageSources);
  } catch (error) {
    await removeIfExists(platform, tempPath, true);
    throw error;
  }

  try {
    await platform.fs.rename(tempPath, dbPath);
  } catch (error) {
    await removeIfExists(platform, tempPath, true);
    if (!(await platform.fs.exists(dbPath))) throw error;
  }
  await cleanupLegacyFiles(platform, dir);
  return true;
}

/**
 * 打开本地库前的统一入口：没有 SQLite 就尝试从旧格式迁移。
 * 旧文件移动失败不应让一个已经有效的 SQLite 库打不开，所以清理只尽力而为。
 */
export async function ensureLocalDatabase(platform: Platform, dir: string): Promise<void> {
  await migrateLegacyWorkspace(platform, dir);
}

async function cleanupLegacyFiles(platform: Platform, dir: string): Promise<void> {
  const legacyDir = platform.paths.join(dir, LAYOUT.legacyDir);
  try {
    for (const entry of LEGACY_ENTRIES) {
      const source = platform.paths.join(dir, entry);
      if (!(await platform.fs.exists(source))) continue;
      if (!(await platform.fs.exists(legacyDir))) await platform.fs.mkdir(legacyDir);
      const target = platform.paths.join(legacyDir, entry);
      if (await platform.fs.exists(target)) {
        // 上一次迁移已备份过同名条目：本次只清理根目录残留。
        await platform.fs.remove(source, { recursive: true });
      } else {
        await platform.fs.rename(source, target);
      }
    }
  } catch {
    // 备份搬运失败不影响 database.sqlite 打开；下次打开会继续尝试。
  }
}
