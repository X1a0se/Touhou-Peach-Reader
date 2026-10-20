import type { Platform } from '@tpr/platform';
import type { Counts, Issue, RawDatabase } from '@tpr/schema';
import type { ContentStore } from './content-store.js';
import { MANIFEST_LAST } from './layout.js';
import { computeCounts } from './normalize.js';
import { DB_LAYOUT, removeTree } from './workspace.js';
import { serializeDatabase } from './write.js';

/**
 * 导出选择器（design §7.6）。优先级：all > series > articles。
 * `all` 是完整备份；其余选择走引用闭包（作者/标签例外，始终全量）。
 */
export interface ExportSelection {
  all?: boolean;
  articles?: string[];
  series?: string[];
  includeCredits?: boolean;
}

export interface ExportSource {
  /** 当前数据库目录（workspace/{databaseId}） */
  dir: string;
  db: RawDatabase;
  contents: ContentStore;
}

export interface ExportResult {
  bytes: Uint8Array;
  counts: Counts;
  warnings: Issue[];
  fileName: string;
}

const skipped = (
  message: string,
  entity: Issue['entity'] = 'article',
  entityId?: string,
): Issue => ({
  code: 'W_EXPORT_SKIPPED',
  severity: 'warning',
  entity,
  message,
  ...(entityId === undefined ? {} : { entityId }),
});

export function selectSubset(
  db: RawDatabase,
  selection: ExportSelection,
): { db: RawDatabase; warnings: Issue[] } {
  const warnings: Issue[] = [];
  const credits = selection.includeCredits === false ? [] : db.credits;

  // B0：全库导出是完整备份，所有集合原样带走，不做引用闭包裁剪。
  // 否则新建后还没挂到文章上的标签/作者会在这里被过滤掉，导入方永远看不到。
  if (selection.all === true) {
    return {
      db: {
        manifest: {
          ...db.manifest,
          counts: computeCounts({ ...db, credits }),
          updatedAt: new Date().toISOString(),
        },
        authors: db.authors,
        tags: db.tags,
        images: db.images,
        articles: db.articles,
        series: db.series,
        featured: db.featured,
        credits,
      },
      warnings,
    };
  }

  const byArticle = new Map(db.articles.map((a) => [a.id, a]));
  const bySeries = new Map(db.series.map((s) => [s.id, s]));

  const picked = new Set<string>();
  for (const id of selection.articles ?? []) {
    if (byArticle.has(id)) picked.add(id);
    else warnings.push(skipped(`文章 ${id} 不存在，已跳过`, 'article', id));
  }
  for (const id of selection.series ?? []) {
    const series = bySeries.get(id);
    if (!series) {
      warnings.push(skipped(`系列 ${id} 不存在，已跳过`, 'series', id));
      continue;
    }
    for (const articleId of series.articleIds) {
      if (byArticle.has(articleId)) picked.add(articleId);
      else
        warnings.push(
          skipped(`系列「${series.title}」引用了不存在的文章 ${articleId}`, 'series', id),
        );
    }
  }

  const articles = db.articles.filter((a) => picked.has(a.id));
  // B2：系列仅当它的全部文章都在闭包里才随包导出
  const series = db.series.filter(
    (s) => s.articleIds.length > 0 && s.articleIds.every((id) => picked.has(id)),
  );

  const authorIds = new Set<string>();
  const tagIds = new Set<string>();
  const imageIds = new Set<string>();
  for (const article of articles) {
    for (const id of article.authorIds) authorIds.add(id);
    for (const id of article.translatorIds ?? []) authorIds.add(id);
    for (const id of article.characterTagIds ?? []) tagIds.add(id);
    for (const id of article.plotTagIds ?? []) tagIds.add(id);
    if (article.coverImageId !== undefined) imageIds.add(article.coverImageId);
    for (const id of article.illustrationImageIds ?? []) imageIds.add(id);
  }
  for (const item of series) {
    for (const id of item.authorIds ?? []) authorIds.add(id);
    for (const id of item.translatorIds ?? []) authorIds.add(id);
    for (const id of item.characterTagIds ?? []) tagIds.add(id);
    for (const id of item.plotTagIds ?? []) tagIds.add(id);
    if (item.coverImageId !== undefined) imageIds.add(item.coverImageId);
  }

  // B1：作者与标签是库级词表，部分导出也全量带走（否则"新建未挂接"的标签会丢）；
  // B3：图片体积大，仍只打包被闭包直接引用的。
  const authors = db.authors;
  const tags = db.tags;
  const images = db.images.filter((i) => imageIds.has(i.id));

  // 全量词表下不能再用"长度差"判断缺失，逐个 id 检查引用是否存在
  const authorSet = new Set(db.authors.map((a) => a.id));
  const tagSet = new Set(db.tags.map((t) => t.id));
  const imageSet = new Set(db.images.map((i) => i.id));
  if ([...authorIds].some((id) => !authorSet.has(id)))
    warnings.push(skipped('部分作者引用无法解析', 'author'));
  if ([...tagIds].some((id) => !tagSet.has(id)))
    warnings.push(skipped('部分标签引用无法解析', 'tag'));
  if ([...imageIds].some((id) => !imageSet.has(id)))
    warnings.push(skipped('部分图片引用无法解析', 'image'));

  // B4：featured 只导出 target 落在闭包内的条目
  const featured = db.featured.filter((entry) =>
    entry.targetType === 'article'
      ? picked.has(entry.targetId)
      : series.some((s) => s.id === entry.targetId),
  );

  const counts = computeCounts({ authors, tags, images, articles, series, featured, credits });

  const subset: RawDatabase = {
    manifest: { ...db.manifest, counts, updatedAt: new Date().toISOString() },
    authors,
    tags,
    images,
    articles,
    series,
    featured,
    // B5：鸣谢默认全量导出
    credits,
  };
  return { db: subset, warnings };
}

const stamp = (): string => {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
};

const safeName = (name: string): string =>
  name
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'touhou-peach';

/** 生成可下载的 `.tpr` 字节（design §7.6 / §9.4）。 */
export async function exportDatabase(
  platform: Platform,
  source: ExportSource,
  selection: ExportSelection,
): Promise<ExportResult> {
  const { db, warnings } = selectSubset(source.db, selection);

  const markdown = new Map<string, string>();
  for (const article of db.articles) {
    try {
      markdown.set(article.id, await source.contents.read(article.id));
    } catch {
      warnings.push(skipped(`正文缺失：${article.title}`, 'article', article.id));
      markdown.set(article.id, '');
    }
  }

  const workDir = platform.paths.join(platform.paths.dataDir, DB_LAYOUT.exportsDir, stamp());
  const zipPath = `${workDir}.tpr`;
  try {
    for (const file of serializeDatabase(db, markdown)) {
      const path = platform.paths.join(workDir, file.path);
      await platform.fs.mkdir(platform.paths.dirname(path));
      await platform.fs.writeText(path, file.text);
    }
    for (const image of db.images) {
      // image.file 已是包内相对路径（images/{kind}/{name}）
      const relative = image.file;
      const from = platform.paths.join(source.dir, relative);
      if (!(await platform.fs.exists(from))) {
        warnings.push(skipped(`图片缺失：${image.file}`, 'image', image.id));
        continue;
      }
      const to = platform.paths.join(workDir, relative);
      await platform.fs.mkdir(platform.paths.dirname(to));
      await platform.fs.copy(from, to);
    }

    await platform.zip.createFromDir(workDir, zipPath, { order: [...MANIFEST_LAST] });
    const bytes = await platform.fs.readBytes(zipPath);
    return {
      bytes,
      counts: db.manifest.counts,
      warnings,
      fileName: `${safeName(db.manifest.name)}-${stamp()}.tpr`,
    };
  } finally {
    await removeTree(platform, workDir);
    await removeTree(platform, zipPath);
  }
}
