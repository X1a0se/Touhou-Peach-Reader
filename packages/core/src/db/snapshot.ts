import type {
  ArticleMeta,
  Author,
  CreditsEntry,
  FeaturedEntry,
  ImageAsset,
  Manifest,
  RawDatabase,
  Series,
  Tag,
} from '@tpr/schema';
import { computeCounts } from './normalize.js';

export interface IdMaps {
  authors: Map<string, Author>;
  tags: Map<string, Tag>;
  images: Map<string, ImageAsset>;
  articles: Map<string, ArticleMeta>;
  series: Map<string, Series>;
}

/** 内存快照：正文被抽走（design §6.1），按需通过 ContentStore 读。 */
export interface DBSnapshot {
  manifest: Manifest;
  authors: Author[];
  tags: Tag[];
  images: ImageAsset[];
  articles: ArticleMeta[];
  series: Series[];
  featured: FeaturedEntry[];
  credits: CreditsEntry[];
  maps: IdMaps;
}

export function toSnapshot(raw: RawDatabase): DBSnapshot {
  const articles: ArticleMeta[] = raw.articles.map(({ content: _content, ...meta }) => meta);
  return {
    // counts 以数组长度为准：旧 workspace 的 manifest 可能停在导入时的数字
    manifest: { ...raw.manifest, counts: computeCounts(raw) },
    authors: raw.authors,
    tags: raw.tags,
    images: raw.images,
    articles,
    series: raw.series,
    featured: raw.featured,
    credits: raw.credits,
    maps: {
      authors: new Map(raw.authors.map((a) => [a.id, a])),
      tags: new Map(raw.tags.map((t) => [t.id, t])),
      images: new Map(raw.images.map((i) => [i.id, i])),
      articles: new Map(articles.map((a) => [a.id, a])),
      series: new Map(raw.series.map((s) => [s.id, s])),
    },
  };
}

export function emptySnapshot(): DBSnapshot {
  return toSnapshot({
    manifest: {
      schemaVersion: 1,
      databaseId: 'db_empty',
      name: '未导入',
      version: '0.0.0',
      updatedAt: new Date(0).toISOString(),
      counts: {},
    },
    authors: [],
    tags: [],
    images: [],
    articles: [],
    series: [],
    featured: [],
    credits: [],
  });
}
