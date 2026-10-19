/**
 * 多库合并（design §10）：纯函数部分。
 *
 * 规则一句话：按 id 归并，`updatedAt` 新者胜；时间戳相同但内容不同才是冲突，
 * 默认保留 base，等用户裁决；图片比较字节哈希，不同绝不自动换图。
 */
import type { Issue } from '@tpr/schema';
import type { DBSnapshot } from '../db/snapshot.js';

export type CollectionKey = 'authors' | 'tags' | 'articles' | 'series' | 'images';

export interface Conflict {
  conflictId: string;
  collection: CollectionKey;
  id: string;
  kind: 'same-time-different-content' | 'binary-different' | 'order-different';
  baseLabel: string;
  incomingLabel: string;
  fields: string[];
}

export interface Duplicate {
  collection: 'authors' | 'tags';
  ids: string[];
  normalizedName: string;
}

export interface MergeReport {
  base: { databaseId: string; name: string; version: string };
  incoming: { databaseId: string; name: string; version: string };
  added: Record<CollectionKey, number>;
  updated: Record<CollectionKey, number>;
  kept: Record<CollectionKey, number>;
  conflicts: Conflict[];
  dangling: Issue[];
  possibleDuplicates: Duplicate[];
}

export type Decision = 'keep-base' | 'take-incoming';

export interface MergeSide {
  snapshot: DBSnapshot;
  /** 图片文件字节的 sha256；没有该 id 时返回 null（只应发生在悬空引用上）。 */
  hashImage(id: string): Promise<string | null>;
}

export interface MergeSources {
  /** 合并后这些文章的正文来自 incoming（新增或被 incoming 更新）。 */
  articleContent: Set<string>;
  /** 合并后这些图片的文件字节来自 incoming。 */
  imageBytes: Set<string>;
}

export interface MergeResult {
  merged: DBSnapshot;
  report: MergeReport;
  sources: MergeSources;
}

const COLLECTIONS: CollectionKey[] = ['authors', 'tags', 'articles', 'series', 'images'];

const emptyCounts = (): Record<CollectionKey, number> => ({
  authors: 0,
  tags: 0,
  articles: 0,
  series: 0,
  images: 0,
});

function stripNoise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNoise);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'updatedAt') continue;
      out[key] = stripNoise(item);
    }
    return out;
  }
  return value;
}

export function deepEqualIgnoringUpdatedAt(a: unknown, b: unknown): boolean {
  return JSON.stringify(stripNoise(a)) === JSON.stringify(stripNoise(b));
}

function changedFields(a: object, b: object): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const fields: string[] = [];
  for (const key of keys) {
    if (key === 'updatedAt') continue;
    if (JSON.stringify((a as Record<string, unknown>)[key]) !== JSON.stringify((b as Record<string, unknown>)[key])) {
      fields.push(key);
    }
  }
  return fields.sort();
}

function labelOf(collection: CollectionKey, entity: { title?: string; name?: string; canonicalName?: string; id: string }): string {
  if (collection === 'authors') return entity.canonicalName ?? entity.id;
  return entity.title ?? entity.name ?? entity.id;
}

function mergeEntityCollection<T extends { id: string; updatedAt?: string }>(
  collection: CollectionKey,
  baseItems: T[],
  incomingItems: T[],
  counts: { added: Record<CollectionKey, number>; updated: Record<CollectionKey, number>; kept: Record<CollectionKey, number> },
  conflicts: Conflict[],
  sources: Set<string>,
): T[] {
  const baseMap = new Map(baseItems.map((item) => [item.id, item]));
  const incomingMap = new Map(incomingItems.map((item) => [item.id, item]));
  const result: T[] = [];

  for (const [id, baseItem] of baseMap) {
    const incomingItem = incomingMap.get(id);
    if (!incomingItem) {
      counts.kept[collection] += 1;
      result.push(baseItem);
      continue;
    }
    const baseAt = baseItem.updatedAt ?? '';
    const incomingAt = incomingItem.updatedAt ?? '';
    if (incomingAt > baseAt) {
      counts.updated[collection] += 1;
      result.push(incomingItem);
      sources.add(id);
    } else if (incomingAt < baseAt) {
      counts.kept[collection] += 1;
      result.push(baseItem);
    } else if (deepEqualIgnoringUpdatedAt(baseItem, incomingItem)) {
      counts.kept[collection] += 1;
      result.push(baseItem);
    } else {
      conflicts.push({
        conflictId: `${collection}:${id}`,
        collection,
        id,
        kind: 'same-time-different-content',
        baseLabel: labelOf(collection, baseItem as never),
        incomingLabel: labelOf(collection, incomingItem as never),
        fields: changedFields(baseItem, incomingItem),
      });
      counts.kept[collection] += 1;
      result.push(baseItem);
    }
  }

  for (const [id, incomingItem] of incomingMap) {
    if (baseMap.has(id)) continue;
    counts.added[collection] += 1;
    sources.add(id);
    result.push(incomingItem);
  }
  return result;
}

export async function mergeDatabases(base: MergeSide, incoming: MergeSide): Promise<MergeResult> {
  const counts = { added: emptyCounts(), updated: emptyCounts(), kept: emptyCounts() };
  const conflicts: Conflict[] = [];
  const sources: MergeSources = { articleContent: new Set(), imageBytes: new Set() };

  const authors = mergeEntityCollection('authors', base.snapshot.authors, incoming.snapshot.authors, counts, conflicts, new Set());
  const tags = mergeEntityCollection('tags', base.snapshot.tags, incoming.snapshot.tags, counts, conflicts, new Set());
  const articles = mergeEntityCollection(
    'articles',
    base.snapshot.articles,
    incoming.snapshot.articles,
    counts,
    conflicts,
    sources.articleContent,
  );
  const series = mergeEntityCollection('series', base.snapshot.series, incoming.snapshot.series, counts, conflicts, new Set());

  // 图片：先按 id 归并，再对两边都有的比字节哈希
  const baseImages = new Map(base.snapshot.images.map((image) => [image.id, image]));
  const images = [...base.snapshot.images];
  for (const image of incoming.snapshot.images) {
    const existing = baseImages.get(image.id);
    if (!existing) {
      counts.added.images += 1;
      sources.imageBytes.add(image.id);
      images.push(image);
      continue;
    }
    const [baseHash, incomingHash] = await Promise.all([base.hashImage(image.id), incoming.hashImage(image.id)]);
    if (baseHash && incomingHash && baseHash === incomingHash) {
      counts.kept.images += 1;
      continue;
    }
    conflicts.push({
      conflictId: `images:${image.id}`,
      collection: 'images',
      id: image.id,
      kind: 'binary-different',
      baseLabel: existing.caption ?? existing.file,
      incomingLabel: image.caption ?? image.file,
      fields: ['file'],
    });
    counts.kept.images += 1;
  }

  // featured：键 = targetType:targetId，推荐语取并集
  const featured = base.snapshot.featured.map((entry) => ({ ...entry, recommendations: [...entry.recommendations] }));
  const featuredIndex = new Map(featured.map((entry) => [`${entry.targetType}:${entry.targetId}`, entry]));
  for (const entry of incoming.snapshot.featured) {
    const key = `${entry.targetType}:${entry.targetId}`;
    const existing = featuredIndex.get(key);
    if (!existing) {
      featured.push({ ...entry, recommendations: [...entry.recommendations] });
      continue;
    }
    const seen = new Set(existing.recommendations.map((item) => `${item.author ?? ''}\u0000${item.text}`));
    for (const item of entry.recommendations) {
      const itemKey = `${item.author ?? ''}\u0000${item.text}`;
      if (!seen.has(itemKey)) {
        seen.add(itemKey);
        existing.recommendations.push({ ...item });
      }
    }
  }

  // credits：键 = 归一化 name + role + link，并集保序
  const credits = base.snapshot.credits.map((entry) => ({ ...entry }));
  const creditKeys = new Set(credits.map((entry) => `${entry.name}\u0000${entry.role ?? ''}\u0000${entry.link ?? ''}`));
  for (const entry of incoming.snapshot.credits) {
    const key = `${entry.name}\u0000${entry.role ?? ''}\u0000${entry.link ?? ''}`;
    if (creditKeys.has(key)) continue;
    creditKeys.add(key);
    credits.push({ ...entry });
  }

  const merged: DBSnapshot = {
    manifest: {
      ...base.snapshot.manifest,
      updatedAt: new Date().toISOString(),
      counts: {
        authors: authors.length,
        tags: tags.length,
        images: images.length,
        articles: articles.length,
        series: series.length,
        featured: featured.length,
        credits: credits.length,
      },
    },
    authors,
    tags,
    images,
    articles,
    series,
    featured,
    credits,
    maps: {
      authors: new Map(authors.map((item) => [item.id, item])),
      tags: new Map(tags.map((item) => [item.id, item])),
      articles: new Map(articles.map((item) => [item.id, item])),
      series: new Map(series.map((item) => [item.id, item])),
      images: new Map(images.map((item) => [item.id, item])),
    },
  };

  const duplicates = findDuplicates(merged);
  const dangling = findDangling(merged);

  return {
    merged,
    sources,
    report: {
      base: {
        databaseId: base.snapshot.manifest.databaseId,
        name: base.snapshot.manifest.name,
        version: base.snapshot.manifest.version,
      },
      incoming: {
        databaseId: incoming.snapshot.manifest.databaseId,
        name: incoming.snapshot.manifest.name,
        version: incoming.snapshot.manifest.version,
      },
      added: counts.added,
      updated: counts.updated,
      kept: counts.kept,
      conflicts,
      dangling,
      possibleDuplicates: duplicates,
    },
  };
}

/** 用户裁决后重新计算 merged：把选中 take-incoming 的冲突项换成 incoming 版本。 */
export interface ConflictSources {
  snapshot: DBSnapshot;
  contents: Map<string, string>;
  imageFiles: Map<string, { file: string }>;
}

export function applyConflicts(
  result: MergeResult,
  decisions: ReadonlyMap<string, Decision>,
  incoming: ConflictSources,
): { result: MergeResult; contents: Map<string, string> } {
  const merged: DBSnapshot = structuredClone(result.merged);
  const contents = new Map<string, string>();
  const remaining: Conflict[] = [];

  for (const conflict of result.report.conflicts) {
    const decision = decisions.get(conflict.conflictId) ?? 'keep-base';
    if (decision === 'keep-base') {
      remaining.push(conflict);
      continue;
    }
    if (conflict.collection === 'articles') {
      const incomingArticle = incoming.snapshot.articles.find((item) => item.id === conflict.id);
      if (incomingArticle) {
        const index = merged.articles.findIndex((item) => item.id === conflict.id);
        if (index >= 0) merged.articles[index] = structuredClone(incomingArticle);
      }
      const incomingContent = incoming.contents.get(conflict.id);
      if (incomingContent !== undefined) contents.set(conflict.id, incomingContent);
    }
    if (conflict.collection === 'images') {
      const image = incoming.imageFiles.get(conflict.id);
      if (image) {
        const index = merged.images.findIndex((item) => item.id === conflict.id);
        if (index >= 0) merged.images[index] = { ...merged.images[index], file: image.file } as never;
      }
    }
  }

  merged.maps = {
    authors: new Map(merged.authors.map((item) => [item.id, item])),
    tags: new Map(merged.tags.map((item) => [item.id, item])),
    articles: new Map(merged.articles.map((item) => [item.id, item])),
    series: new Map(merged.series.map((item) => [item.id, item])),
    images: new Map(merged.images.map((item) => [item.id, item])),
  };

  return {
    result: {
      ...result,
      merged,
      report: { ...result.report, conflicts: remaining },
    },
    contents,
  };
}

function findDuplicates(snapshot: DBSnapshot): Duplicate[] {
  const out: Duplicate[] = [];
  const group = (collection: 'authors' | 'tags', entries: { id: string; name: string }[]) => {
    const map = new Map<string, string[]>();
    for (const entry of entries) {
      const key = entry.name.normalize('NFKC').toLowerCase().replace(/[\s\u3000]+/gu, ' ').trim();
      map.set(key, [...(map.get(key) ?? []), entry.id]);
    }
    for (const [normalizedName, ids] of map) {
      if (ids.length >= 2) out.push({ collection, ids, normalizedName });
    }
  };
  group(
    'authors',
    snapshot.authors.map((author) => ({ id: author.id, name: author.canonicalName })),
  );
  group(
    'tags',
    snapshot.tags.map((tag) => ({ id: tag.id, name: tag.name })),
  );
  return out;
}

function findDangling(snapshot: DBSnapshot): Issue[] {
  const issues: Issue[] = [];
  const authorIds = new Set(snapshot.authors.map((author) => author.id));
  const tagIds = new Set(snapshot.tags.map((tag) => tag.id));
  const seriesIds = new Set(snapshot.series.map((series) => series.id));
  const articleIds = new Set(snapshot.articles.map((article) => article.id));
  const imageIds = new Set(snapshot.images.map((image) => image.id));

  const push = (code: string, entity: Issue['entity'], id: string, field: string, message: string) => {
    issues.push({ code, severity: 'warning', entity, entityId: id, field, message });
  };

  for (const article of snapshot.articles) {
    for (const id of article.authorIds) {
      if (!authorIds.has(id)) push('W_DANGLING_AUTHOR', 'article', article.id, 'authorIds', `作者 ${id} 不存在`);
    }
    for (const id of article.characterTagIds) {
      if (!tagIds.has(id)) push('W_DANGLING_TAG', 'article', article.id, 'characterTagIds', `标签 ${id} 不存在`);
    }
    if (article.seriesId && !seriesIds.has(article.seriesId)) {
      push('W_DANGLING_SERIES', 'article', article.id, 'seriesId', `系列 ${article.seriesId} 不存在`);
    }
    if (article.coverImageId && !imageIds.has(article.coverImageId)) {
      push('W_DANGLING_IMAGE', 'article', article.id, 'coverImageId', `图片 ${article.coverImageId} 不存在`);
    }
  }
  for (const series of snapshot.series) {
    for (const id of series.articleIds) {
      if (!articleIds.has(id)) push('W_DANGLING_SERIES', 'series', series.id, 'articleIds', `文章 ${id} 不存在`);
    }
  }
  return issues;
}
