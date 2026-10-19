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

const imageRef = (snapshot: DBSnapshot, dir: string, id: string, join: (...parts: string[]) => string): ImageRef | null => {
  const image = snapshot.maps.images.get(id);
  if (!image) return null;
  return {
    id: image.id,
    file: image.file,
    kind: image.kind,
    caption: image.caption ?? null,
    path: join(dir, image.file),
  };
};

const compact = <T>(values: ReadonlyArray<T | null>): T[] => values.filter((value): value is T => value !== null);

export interface ViewOptions {
  /** 库目录（workspace/{databaseId}），用于拼图片绝对路径 */
  dir: string;
  join(...parts: string[]): string;
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
    characterTags: compact(article.characterTagIds.map((tagId) => tagRef(snapshot, tagId))),
    plotTags: compact(article.plotTagIds.map((tagId) => tagRef(snapshot, tagId))),
    series: series
      ? { id: series.id, title: series.title, status: series.status, index: position >= 0 ? position + 1 : null }
      : null,
    cover: article.coverImageId ? imageRef(snapshot, opts.dir, article.coverImageId, opts.join) : null,
    illustrations: compact(
      (article.illustrationImageIds ?? []).map((imageId) => imageRef(snapshot, opts.dir, imageId, opts.join)),
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
    characterTags: compact(series.characterTagIds.map((tagId) => tagRef(snapshot, tagId))),
    plotTags: compact(series.plotTagIds.map((tagId) => tagRef(snapshot, tagId))),
    cover: series.coverImageId ? imageRef(snapshot, opts.dir, series.coverImageId, opts.join) : null,
    articles,
    sourceUrl: series.sourceUrl ?? null,
  };
}
