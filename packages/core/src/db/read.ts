import { PlatformError } from '@tpr/platform';
import {
  articleFileSchema,
  authorSchema,
  creditsEntrySchema,
  featuredEntrySchema,
  imageAssetSchema,
  manifestSchema,
  type RawDatabase,
  seriesSchema,
  tagSchema,
} from '@tpr/schema';
import type { DbIo } from './layout.js';
import { articleJson, LAYOUT, seriesJson } from './layout.js';

/** 只依赖 safeParse 的结构类型：core 不直接依赖 zod。 */
interface SchemaLike<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export interface ReadOptions {
  /** 单个实体读不出来时不是致命错误：跳过它、继续打开整库（design §9.4） */
  onWarning?: (message: string, path: string) => void;
  /**
   * 读包进度（Goal 31）：done / total 都是"已读 / 待读"的包内文件数。
   * total 用 scanFilePaths 扫到的文件总数，读完后一定是满的。
   */
  onProgress?: (done: number, total: number) => void;
}

/**
 * 有界并发地跑异步任务，结果顺序与入参一致（用于保留读取顺序与警告顺序）。
 * 读包是几百上千次独立的文件调用，串行在桌面端就是几百次 IPC 往返。
 */
const READ_CONCURRENCY = 16;

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function readJson(io: DbIo, dir: string, relative: string): Promise<unknown | undefined> {
  // 不先 exists 再读：文件缺失时 readText 直接抛错，省掉一次 IPC。
  try {
    return JSON.parse(await io.fs.readText(io.join(dir, relative))) as unknown;
  } catch {
    return undefined;
  }
}

async function readArray<T>(
  io: DbIo,
  dir: string,
  relative: string,
  schema: SchemaLike<T>,
  opts: ReadOptions,
): Promise<T[]> {
  const value = await readJson(io, dir, relative);
  if (value === undefined) {
    if (await io.fs.exists(io.join(dir, relative))) {
      opts.onWarning?.(`${relative} 解析失败，按空集合处理`, relative);
    }
    return [];
  }
  if (!Array.isArray(value)) {
    opts.onWarning?.(`${relative} 不是数组，按空集合处理`, relative);
    return [];
  }
  const out: T[] = [];
  for (const item of value) {
    const parsed = schema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
    else opts.onWarning?.(`${relative} 中有条目不符合 schema，已跳过`, relative);
  }
  return out;
}

async function readEntityDir<T>(
  io: DbIo,
  dir: string,
  subdir: string,
  schema: SchemaLike<T>,
  relativeOf: (id: string) => string,
  opts: ReadOptions,
): Promise<T[]> {
  const abs = io.join(dir, subdir);
  if (!(await io.fs.exists(abs))) return [];
  const entries = (await io.fs.listDir(abs)).filter(
    (entry) => !entry.isDirectory && entry.name.endsWith('.json'),
  );
  const loaded = await mapLimit(entries, READ_CONCURRENCY, async (entry) => {
    const relative = relativeOf(entry.name.slice(0, -'.json'.length));
    try {
      const value: unknown = JSON.parse(await io.fs.readText(io.join(dir, relative)));
      opts.onProgress?.(1, 0);
      return { relative, value, failed: false };
    } catch {
      return { relative, value: undefined as unknown, failed: true };
    }
  });
  const out: T[] = [];
  for (const item of loaded) {
    if (item.failed) {
      opts.onWarning?.(`${item.relative} 解析失败，已跳过`, item.relative);
      continue;
    }
    const parsed = schema.safeParse(item.value);
    if (parsed.success) out.push(parsed.data);
    else opts.onWarning?.(`${item.relative} 不符合 schema，已跳过`, item.relative);
  }
  return out;
}

/** 扫描包内实际存在的文件（相对路径，`/` 分隔），用于校验正文与图片引用。 */
export async function scanFilePaths(io: DbIo, dir: string): Promise<Set<string>> {
  const paths = new Set<string>();
  type Entry = Awaited<ReturnType<DbIo['fs']['listDir']>>[number];
  const listIfExists = async (abs: string): Promise<Entry[]> =>
    (await io.fs.exists(abs)) ? await io.fs.listDir(abs) : [];

  const subdirs = [LAYOUT.articlesDir, LAYOUT.seriesDir];
  const listings = await Promise.all(subdirs.map((subdir) => listIfExists(io.join(dir, subdir))));
  for (const [index, entries] of listings.entries()) {
    const subdir = subdirs[index] as string;
    for (const entry of entries) {
      if (!entry.isDirectory) paths.add(`${subdir}/${entry.name}`);
    }
  }

  const kindDirs = await listIfExists(io.join(dir, LAYOUT.imagesDir));
  const kindListings = await Promise.all(
    kindDirs
      .filter((kindDir) => kindDir.isDirectory)
      .map(async (kindDir) => ({ kindDir, files: await io.fs.listDir(kindDir.path) })),
  );
  for (const { kindDir, files } of kindListings) {
    for (const file of files) {
      if (!file.isDirectory) paths.add(`${LAYOUT.imagesDir}/${kindDir.name}/${file.name}`);
    }
  }
  return paths;
}

export async function readDatabaseDir(
  io: DbIo,
  dir: string,
  opts: ReadOptions = {},
): Promise<RawDatabase> {
  const manifestPath = io.join(dir, LAYOUT.manifest);
  if (!(await io.fs.exists(manifestPath))) {
    throw new PlatformError('EIO', `不是有效的数据库目录：缺少 ${LAYOUT.manifest}`);
  }
  // 先扫一遍包内文件，既给校验用，也给进度一个真实的分母（读完后必然满格）
  const filePaths = await scanFilePaths(io, dir);
  const totalFiles = Math.max(1, filePaths.size);
  let readFiles = 0;
  const tick: ReadOptions = {
    ...opts,
    onProgress: (_step, _total) => {
      readFiles += 1;
      opts.onProgress?.(readFiles, totalFiles);
    },
  };
  let manifest: RawDatabase['manifest'];
  try {
    manifest = manifestSchema.parse(JSON.parse(await io.fs.readText(manifestPath)));
  } catch (error) {
    throw new PlatformError('EIO', `${LAYOUT.manifest} 解析失败：库可能已损坏`, error);
  }

  const [authors, tags, images, featured, credits] = await Promise.all([
    readArray(io, dir, LAYOUT.authors, authorSchema, opts),
    readArray(io, dir, LAYOUT.tags, tagSchema, opts),
    readArray(io, dir, LAYOUT.images, imageAssetSchema, opts),
    readArray(io, dir, LAYOUT.featured, featuredEntrySchema, opts),
    readArray(io, dir, LAYOUT.credits, creditsEntrySchema, opts),
  ]);
  const articles = await readEntityDir(
    io,
    dir,
    LAYOUT.articlesDir,
    articleFileSchema,
    articleJson,
    tick,
  );
  // series 只有"一实体一文件"形态（§7.2 的目录树里没有 series.json）
  const series = await readEntityDir(io, dir, LAYOUT.seriesDir, seriesSchema, seriesJson, tick);

  opts.onProgress?.(totalFiles, totalFiles);
  return {
    manifest,
    authors,
    tags,
    images,
    articles,
    series,
    featured,
    credits,
    filePaths,
  };
}
