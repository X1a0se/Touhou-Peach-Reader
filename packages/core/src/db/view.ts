/**
 * 详情页的只读视图（Goal 5）：把 id 关系解析成人能直接渲染的结构。
 * 纯函数、零 IO；正文仍由 `Library.readContent()` 按需读取（design §10）。
 */
import type { ArticleMeta, ImageAsset, Series, TagCategory } from '@tpr/schema';
import type { DBSnapshot } from './snapshot.js';

export interface PersonRef {
  id: string;
  name: string;
  aliases: readonly string[];
}

export interface TagRef {
  id: string;
  name: string;
  category: TagCategory;
}

export interface ImageRef {
  id: string;
  file: string;
  kind: ImageAsset['kind'];
  caption: string | null;
  /** 包内相对路径拼上库目录后的绝对路径，交给 `assets.toUrl` */
  path: string;
}

export interface SeriesBrief {
  id: string;
  title: string;
  status: Series['status'];
  /** 1 起的序号；`null` 表示文章不在 `articleIds` 里（数据不一致时兜底） */
  index: number | null;
}

export interface ArticleView {
  article: ArticleMeta;
  authors: PersonRef[];
  translators: PersonRef[];
  characterTags: TagRef[];
  plotTags: TagRef[];
  series: SeriesBrief | null;
  cover: ImageRef | null;
  illustrations: ImageRef[];
  sourceUrl: string | null;
}

export interface SeriesView {
  series: Series;
  authors: PersonRef[];
  characterTags: TagRef[];
  plotTags: TagRef[];
  cover: ImageRef | null;
  articles: ArticleMeta[];
  sourceUrl: string | null;
}

const personRef = (snapshot: DBSnapshot, id: string): PersonRef | null => {
  const author = snapshot.maps.authors.get(id);
  return author ? { id: author.id, name: author.canonicalName, aliases: author.aliases ?? [] } : null;
};

const tagRef = (snapshot: DBSnapshot, id: string): TagRef | null => {
  const tag = snapshot.maps.tags.get(id);
  return tag ? { id: tag.id, name: tag.name, category: tag.category } : null;
};

/** 按传入顺序解析标签 id：去重、跳过悬空 id。缩略卡片与详情页共用。 */
export function resolveTags(snapshot: DBSnapshot, ids: readonly string[] | undefined): TagRef[] {
  if (!ids) return [];
  const seen = new Set<string>();
  const tags: TagRef[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const ref = tagRef(snapshot, id);
    if (ref) tags.push(ref);
  }
  return tags;
}

export function resolveImageRef(snapshot: DBSnapshot, opts: ViewOptions, id: string): ImageRef | null {
  const image = snapshot.maps.images.get(id);
  if (!image) return null;
  return {
    id: image.id,
    file: image.file,
    kind: image.kind,
    caption: image.caption ?? null,
    path: opts.join(opts.dir, image.file),
  };
}

const compact = <T>(values: ReadonlyArray<T | null>): T[] => values.filter((value): value is T => value !== null);

export interface ViewOptions {
  /** 库目录（workspace/{databaseId}），用于拼图片绝对路径 */
  dir: string;
  join(...parts: string[]): string;
}

/**
 * 文章在所属系列里的 1 基编号（design §13.6：编号即 `articleIds` 的位置）。
 * 系列不存在、或文章不在目录里时返回 `null`，调用方据此显示「未编号」。
 */
export function articleSeriesPosition(
  snapshot: DBSnapshot,
  articleId: string,
): { series: Series; index: number } | null {
  const article = snapshot.maps.articles.get(articleId);
  const series = article?.seriesId ? snapshot.maps.series.get(article.seriesId) : undefined;
  if (!series) return null;
  const position = series.articleIds.indexOf(articleId);
  return position >= 0 ? { series, index: position + 1 } : null;
}

export function getArticleView(snapshot: DBSnapshot, id: string, opts: ViewOptions): ArticleView | null {
  const article = snapshot.maps.articles.get(id);
  if (!article) return null;

  const series = article.seriesId ? snapshot.maps.series.get(article.seriesId) : undefined;
  const position = series ? series.articleIds.indexOf(article.id) : -1;

  return {
    article,
    authors: compact(article.authorIds.map((authorId) => personRef(snapshot, authorId))),
    translators: compact(article.translatorIds.map((authorId) => personRef(snapshot, authorId))),
    characterTags: resolveTags(snapshot, article.characterTagIds),
    plotTags: resolveTags(snapshot, article.plotTagIds),
    series: series
      ? { id: series.id, title: series.title, status: series.status, index: position >= 0 ? position + 1 : null }
      : null,
    cover: article.coverImageId ? resolveImageRef(snapshot, opts, article.coverImageId) : null,
    illustrations: compact(
      (article.illustrationImageIds ?? []).map((imageId) => resolveImageRef(snapshot, opts, imageId)),
    ),
    sourceUrl: article.sourceUrl ?? null,
  };
}

export function getSeriesView(snapshot: DBSnapshot, id: string, opts: ViewOptions): SeriesView | null {
  const series = snapshot.maps.series.get(id);
  if (!series) return null;

  // 以 `articleIds` 的顺序为准；缺失的 id 直接跳过（数据不一致时不连带崩掉整页）
  const articles = compact(series.articleIds.map((articleId) => snapshot.maps.articles.get(articleId) ?? null));

  return {
    series,
    authors: compact(series.authorIds.map((authorId) => personRef(snapshot, authorId))),
    characterTags: resolveTags(snapshot, series.characterTagIds),
    plotTags: resolveTags(snapshot, series.plotTagIds),
    cover: series.coverImageId ? resolveImageRef(snapshot, opts, series.coverImageId) : null,
    articles,
    sourceUrl: series.sourceUrl ?? null,
  };
}
