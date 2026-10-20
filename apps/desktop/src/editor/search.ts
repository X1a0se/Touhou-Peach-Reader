import type { DBSnapshot } from '@tpr/core';
import { normalizeName } from '@tpr/schema';

/** 编辑器里可搜索的实体类别，与七个标签页同名。 */
export type EditorKind =
  | 'articles'
  | 'series'
  | 'authors'
  | 'tags'
  | 'images'
  | 'featured'
  | 'credits';

export const EDITOR_KINDS: readonly EditorKind[] = [
  'articles',
  'series',
  'authors',
  'tags',
  'images',
  'featured',
  'credits',
];

export const EDITOR_KIND_LABEL: Record<EditorKind, string> = {
  articles: '文章',
  series: '系列',
  authors: '作者',
  tags: '标签',
  images: '图片',
  featured: '推荐语',
  credits: '鸣谢',
};

export const TAG_CATEGORY_LABEL: Record<string, string> = {
  character: '角色',
  plot: '情节',
  series: '系列',
  general: '通用',
};

const IMAGE_KIND_LABEL: Record<string, string> = {
  cover: '封面',
  illustration: '插图',
  captioned: '配图',
  other: '其他',
};

export interface EditorSearchHit {
  kind: EditorKind;
  /** 目标 id；推荐语是 `article:xxx` / `series:xxx`，鸣谢是 `credits:{index}` */
  id: string;
  label: string;
  detail?: string;
}

export interface EditorSearchResult {
  /** 按类别顺序、每类最多 `limitPerKind` 条，用于下拉 */
  hits: EditorSearchHit[];
  /** 每类总匹配数（不受 limit 影响） */
  totals: Record<EditorKind, number>;
  /** 每类全量匹配 id，用于当前标签页列表过滤 */
  ids: Record<EditorKind, Set<string>>;
}

function emptyTotals(): Record<EditorKind, number> {
  return { articles: 0, series: 0, authors: 0, tags: 0, images: 0, featured: 0, credits: 0 };
}

function emptyIds(): Record<EditorKind, Set<string>> {
  return {
    articles: new Set(),
    series: new Set(),
    authors: new Set(),
    tags: new Set(),
    images: new Set(),
    featured: new Set(),
    credits: new Set(),
  };
}

/** NFKC + 小写 + 按空白切分 + 去重；空查询返回空数组。 */
export function tokenizeQuery(raw: string): string[] {
  return [...new Set(normalizeName(raw).split(/\s+/).filter(Boolean))];
}

function matches(haystack: string, tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const text = normalizeName(haystack);
  return tokens.every((token) => text.includes(token));
}

function joinParts(parts: Array<string | undefined | null>): string {
  return parts.filter((part): part is string => Boolean(part?.trim())).join(' ');
}

/**
 * 编辑器搜索：跨七类实体做「全部关键词都命中」的子串匹配。
 *
 * 只读内存快照，不碰磁盘；命中结果同时提供「下拉展示用的前 N 条」与
 * 「列表过滤用的全量 id 集合」。空查询返回 null，表示不启用任何过滤。
 */
export function searchEditor(
  snapshot: DBSnapshot,
  rawQuery: string,
  limitPerKind = 6,
): EditorSearchResult | null {
  const tokens = tokenizeQuery(rawQuery);
  if (tokens.length === 0) return null;

  const totals = emptyTotals();
  const ids = emptyIds();
  const hits: EditorSearchHit[] = [];

  const push = (
    kind: EditorKind,
    id: string,
    label: string,
    detail: string | undefined,
    haystack: string,
  ): void => {
    if (!matches(haystack, tokens)) return;
    totals[kind] += 1;
    ids[kind].add(id);
    if (totals[kind] <= limitPerKind) hits.push({ kind, id, label, ...(detail ? { detail } : {}) });
  };

  const authorById = snapshot.maps.authors;
  const tagById = snapshot.maps.tags;
  const articleById = snapshot.maps.articles;
  const seriesById = snapshot.maps.series;

  const peopleHaystack = (personIds: readonly string[]): string =>
    personIds
      .map((personId) => authorById.get(personId))
      .filter((person): person is NonNullable<typeof person> => Boolean(person))
      .map((person) => joinParts([person.canonicalName, ...person.aliases]))
      .join(' ');

  const tagHaystack = (tagIds: readonly string[]): string =>
    tagIds
      .map((tagId) => tagById.get(tagId))
      .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag))
      .map((tag) =>
        joinParts([
          tag.name,
          ...(tag.aliases ?? []),
          TAG_CATEGORY_LABEL[tag.category] ?? tag.category,
        ]),
      )
      .join(' ');

  for (const article of snapshot.articles) {
    const position = article.seriesId
      ? snapshot.series.find((series) => series.articleIds.includes(article.id))
      : undefined;
    const index = position ? position.articleIds.indexOf(article.id) + 1 : 0;
    const detail =
      article.type === 'short'
        ? '短篇'
        : index > 0
          ? `系列《${position?.title}》第 ${index} 篇`
          : '系列条目';
    push(
      'articles',
      article.id,
      article.title,
      detail,
      joinParts([
        article.title,
        article.summary,
        peopleHaystack(article.authorIds),
        peopleHaystack(article.translatorIds),
        tagHaystack(article.characterTagIds),
        tagHaystack(article.plotTagIds),
        detail,
      ]),
    );
  }

  for (const series of snapshot.series) {
    push(
      'series',
      series.id,
      series.title,
      `${series.articleIds.length} 篇`,
      joinParts([
        series.title,
        series.summary,
        peopleHaystack(series.authorIds),
        tagHaystack(series.characterTagIds),
        tagHaystack(series.plotTagIds),
        series.status === 'completed' ? '已完结' : '连载中',
      ]),
    );
  }

  for (const author of snapshot.authors) {
    push(
      'authors',
      author.id,
      author.canonicalName,
      author.aliases.length > 0 ? `别名：${author.aliases.join('、')}` : undefined,
      joinParts([author.canonicalName, ...author.aliases, author.notes]),
    );
  }

  for (const tag of snapshot.tags) {
    push(
      'tags',
      tag.id,
      tag.name,
      TAG_CATEGORY_LABEL[tag.category] ?? tag.category,
      joinParts([
        tag.name,
        ...(tag.aliases ?? []),
        TAG_CATEGORY_LABEL[tag.category] ?? tag.category,
      ]),
    );
  }

  for (const image of snapshot.images) {
    push(
      'images',
      image.id,
      image.caption?.trim() || image.id,
      IMAGE_KIND_LABEL[image.kind] ?? image.kind,
      joinParts([image.caption, image.id, IMAGE_KIND_LABEL[image.kind] ?? image.kind]),
    );
  }

  for (const entry of snapshot.featured) {
    const target =
      entry.targetType === 'article'
        ? articleById.get(entry.targetId)
        : seriesById.get(entry.targetId);
    const label = target?.title ?? `${entry.targetId}（目标缺失）`;
    const id = `${entry.targetType}:${entry.targetId}`;
    const recHaystack = entry.recommendations
      .map((recommendation) => joinParts([recommendation.author, recommendation.text]))
      .join(' ');
    push(
      'featured',
      id,
      label,
      entry.recommendations.length > 0 ? `${entry.recommendations.length} 条推荐语` : '没有推荐语',
      joinParts([
        label,
        entry.targetId,
        recHaystack,
        entry.targetType === 'article' ? '文章' : '系列',
      ]),
    );
  }

  snapshot.credits.forEach((entry, index) => {
    push(
      'credits',
      `credits:${index}`,
      entry.name,
      entry.role ?? undefined,
      joinParts([entry.name, entry.role, entry.note, entry.link]),
    );
  });

  return { hits, totals, ids };
}
