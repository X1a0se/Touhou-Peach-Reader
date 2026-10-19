import type {
  ArticleFile,
  Author,
  CreditsEntry,
  FeaturedEntry,
  ImageAsset,
  Series,
  Tag,
  TagCategory,
} from '../entities.js';
import type { RawDatabase } from '../raw.js';

/**
 * 测试夹具工厂：让每个用例只写"和本用例相关"的字段。
 * id 用递增十六进制，保证同一进程内不重复、且符合 id 正则。
 */

export const FIXED_TIME = '2026-01-02T03:04:05.000Z';

let seq = 0;
const hex12 = (): string => (seq++).toString(16).padStart(12, '0');
const hex16 = (): string => (seq++).toString(16).padStart(16, '0');

export function makeAuthor(over: Partial<Author> = {}): Author {
  return {
    id: `p_${hex12()}`,
    canonicalName: '示例作者',
    aliases: [],
    ...over,
  };
}

export function makeTag(over: Partial<Tag> & { category?: TagCategory } = {}): Tag {
  return {
    id: `t_${hex12()}`,
    category: 'character',
    name: '示例标签',
    aliases: [],
    ...over,
  };
}

export function makeImage(over: Partial<ImageAsset> = {}): ImageAsset {
  const id = over.id ?? `i_${hex16()}`;
  return {
    id,
    file: `images/cover/${id}.webp`,
    kind: 'cover',
    ...over,
  };
}

export function makeArticle(over: Partial<ArticleFile> = {}): ArticleFile {
  const id = over.id ?? `a_${hex16()}`;
  return {
    id,
    type: 'short',
    title: '示例文章',
    summary: '示例简介',
    content: { file: `articles/${id}.md` },
    authorIds: [],
    translatorIds: [],
    characterTagIds: [],
    plotTagIds: [],
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    ...over,
  };
}

export function makeSeries(over: Partial<Series> = {}): Series {
  return {
    id: `s_${hex16()}`,
    title: '示例系列',
    summary: '示例系列简介',
    status: 'ongoing',
    articleIds: [],
    authorIds: [],
    translatorIds: [],
    characterTagIds: [],
    plotTagIds: [],
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    ...over,
  };
}

export function makeFeatured(over: Partial<FeaturedEntry> = {}): FeaturedEntry {
  return {
    targetType: 'article',
    targetId: `a_${hex16()}`,
    recommendations: [{ author: '推荐人', text: '很好看。' }],
    ...over,
  };
}

export function makeCredits(over: Partial<CreditsEntry> = {}): CreditsEntry {
  return { name: '鸣谢某人', role: '校对', ...over };
}

/** 由实体自身的引用关系推出"包内应存在的文件路径" */
export function filePathsFor(db: RawDatabase): Set<string> {
  const paths = new Set<string>();
  for (const a of db.articles) {
    if (typeof a.content === 'object' && a.content !== null) paths.add(a.content.file);
  }
  for (const i of db.images) paths.add(i.file);
  return paths;
}

export interface DatabaseOptions {
  articles?: number;
  withFiles?: boolean;
}

/**
 * 一个自洽的小库：1 作者 + 1 角色标签 + 1 系列（2 篇）+ 1 短篇 + 1 封面 + 1 精选 + 1 鸣谢。
 */
export function makeDatabase(over: Partial<RawDatabase> = {}, opts: DatabaseOptions = {}): RawDatabase {
  const author = makeAuthor({ canonicalName: '雾雨魔理沙' });
  const character = makeTag({ category: 'character', name: '雾雨魔理沙' });
  const plot = makeTag({ category: 'plot', name: '红魔馆' });
  const cover = makeImage({ kind: 'cover' });
  const series = makeSeries({
    title: '示例系列',
    status: 'completed',
    authorIds: [author.id],
    characterTagIds: [character.id],
    coverImageId: cover.id,
  });
  const entry1 = makeArticle({
    type: 'series-entry',
    seriesId: series.id,
    title: '系列第一篇',
    authorIds: [author.id],
    characterTagIds: [character.id],
    plotTagIds: [plot.id],
    coverImageId: cover.id,
  });
  const entry2 = makeArticle({
    type: 'series-entry',
    seriesId: series.id,
    title: '系列第二篇',
    authorIds: [author.id],
  });
  const short = makeArticle({
    title: '独立短篇',
    authorIds: [author.id],
    characterTagIds: [character.id],
  });

  const base: RawDatabase = {
    manifest: {
      schemaVersion: 1,
      databaseId: 'db_7c1f0a9e2b34',
      name: '示例数据库',
      version: '1.0.0',
      updatedAt: FIXED_TIME,
      counts: {},
    },
    authors: [author],
    tags: [character, plot],
    images: [cover],
    articles: [entry1, entry2, short],
    series: [{ ...series, articleIds: [entry1.id, entry2.id] }],
    featured: [
      { targetType: 'series', targetId: series.id, recommendations: [{ author: '推荐人甲', text: '分镜很好。' }, { text: '没有署名的推荐。' }] },
    ],
    credits: [makeCredits()],
  };

  const merged: RawDatabase = { ...base, ...over };
  merged.manifest = {
    ...merged.manifest,
    counts: {
      authors: merged.authors.length,
      tags: merged.tags.length,
      images: merged.images.length,
      articles: merged.articles.length,
      series: merged.series.length,
      featured: merged.featured.length,
      credits: merged.credits.length,
    },
  };
  if (opts.withFiles !== false) merged.filePaths = filePathsFor(merged);
  return merged;
}
