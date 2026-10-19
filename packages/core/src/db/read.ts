import { PlatformError } from '@tpr/platform';
import {
  articleFileSchema,
  authorSchema,
  creditsEntrySchema,
  featuredEntrySchema,
  imageAssetSchema,
  manifestSchema,
  seriesSchema,
  tagSchema,
  type RawDatabase,
} from '@tpr/schema';
import { LAYOUT, seriesJson, articleJson } from './layout.js';
import type { DbIo } from './layout.js';

/** 只依赖 safeParse 的结构类型：core 不直接依赖 zod。 */
interface SchemaLike<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export interface ReadOptions {
  /** 单个实体读不出来时不是致命错误：跳过它、继续打开整库（design §9.4） */
  onWarning?: (message: string, path: string) => void;
}

async function readJson(io: DbIo, dir: string, relative: string): Promise<unknown | undefined> {
  const path = io.join(dir, relative);
  if (!(await io.fs.exists(path))) return undefined;
  try {
    return JSON.parse(await io.fs.readText(path)) as unknown;
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
  const out: T[] = [];
  for (const entry of await io.fs.listDir(abs)) {
    if (entry.isDirectory || !entry.name.endsWith('.json')) continue;
    const relative = relativeOf(entry.name.slice(0, -'.json'.length));
    try {
      const parsed = schema.safeParse(JSON.parse(await io.fs.readText(io.join(dir, relative))));
      if (parsed.success) out.push(parsed.data);
      else opts.onWarning?.(`${relative} 不符合 schema，已跳过`, relative);
    } catch {
      opts.onWarning?.(`${relative} 解析失败，已跳过`, relative);
    }
  }
  return out;
}

/** 扫描包内实际存在的文件（相对路径，`/` 分隔），用于校验正文与图片引用。 */
export async function scanFilePaths(io: DbIo, dir: string): Promise<Set<string>> {
  const paths = new Set<string>();
  for (const subdir of [LAYOUT.articlesDir, LAYOUT.seriesDir]) {
    const abs = io.join(dir, subdir);
    if (!(await io.fs.exists(abs))) continue;
    for (const entry of await io.fs.listDir(abs)) {
      if (!entry.isDirectory) paths.add(`${subdir}/${entry.name}`);
    }
  }
  const imagesAbs = io.join(dir, LAYOUT.imagesDir);
  if (await io.fs.exists(imagesAbs)) {
    for (const kindDir of await io.fs.listDir(imagesAbs)) {
      if (!kindDir.isDirectory) continue;
      for (const file of await io.fs.listDir(kindDir.path)) {
        if (!file.isDirectory) paths.add(`${LAYOUT.imagesDir}/${kindDir.name}/${file.name}`);
      }
    }
  }
  return paths;
}

export async function readDatabaseDir(io: DbIo, dir: string, opts: ReadOptions = {}): Promise<RawDatabase> {
  const manifestPath = io.join(dir, LAYOUT.manifest);
  if (!(await io.fs.exists(manifestPath))) {
    throw new PlatformError('EIO', `不是有效的数据库目录：缺少 ${LAYOUT.manifest}`);
  }
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
  const articles = await readEntityDir(io, dir, LAYOUT.articlesDir, articleFileSchema, articleJson, opts);
  // series 只有"一实体一文件"形态（§7.2 的目录树里没有 series.json）
  const series = await readEntityDir(io, dir, LAYOUT.seriesDir, seriesSchema, seriesJson, opts);

  const filePaths = await scanFilePaths(io, dir);
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
