import type { RawDatabase } from '@tpr/schema';
import {
  makeAuthor,
  makeDatabase,
  makeFeatured,
  makeImage,
  makeSeries,
  makeTag,
} from '@tpr/schema/testing';
import { describe, expect, it } from 'vitest';
import { selectSubset } from '../src/db/export.js';

interface UnusedFixture {
  db: RawDatabase;
  unusedTagId: string;
  unusedAuthorId: string;
  unusedImageId: string;
  emptySeriesId: string;
}

/**
 * 在标准夹具上追加「没被任何文章引用」的实体（design §7.6 B0/B1 的回归场景）：
 * 用户新建标签后还没挂到文章上就导出，旧实现会在闭包里把它过滤掉。
 */
function withUnusedEntities(): UnusedFixture {
  const base = makeDatabase();
  const tag = makeTag({ category: 'general', name: '未挂接标签' });
  const author = makeAuthor({ canonicalName: '未挂接作者' });
  const image = makeImage({ kind: 'illustration' });
  const emptySeries = makeSeries({ title: '空系列', articleIds: [] });
  const featured = makeFeatured({
    targetType: 'series',
    targetId: emptySeries.id,
    recommendations: [{ author: '推荐人丙', text: '空系列推荐语。' }],
  });
  return {
    db: {
      ...base,
      authors: [...base.authors, author],
      tags: [...base.tags, tag],
      images: [...base.images, image],
      series: [...base.series, emptySeries],
      featured: [...base.featured, featured],
    },
    unusedTagId: tag.id,
    unusedAuthorId: author.id,
    unusedImageId: image.id,
    emptySeriesId: emptySeries.id,
  };
}

const arrayCounts = (db: RawDatabase): Record<string, number> => ({
  authors: db.authors.length,
  tags: db.tags.length,
  articles: db.articles.length,
  series: db.series.length,
  images: db.images.length,
  featured: db.featured.length,
  credits: db.credits.length,
});

describe('selectSubset: 全库导出是完整备份（B0）', () => {
  it('all-keeps-unreferenced: 未挂接的标签/作者/图片与空系列推荐语都进包', () => {
    const { db, unusedTagId, unusedAuthorId, unusedImageId, emptySeriesId } = withUnusedEntities();
    const { db: subset, warnings } = selectSubset(db, { all: true });

    expect(warnings).toEqual([]);
    expect(subset.tags.map((tag) => tag.id)).toContain(unusedTagId);
    expect(subset.authors.map((author) => author.id)).toContain(unusedAuthorId);
    expect(subset.images.map((image) => image.id)).toContain(unusedImageId);
    expect(subset.series.map((series) => series.id)).toContain(emptySeriesId);
    expect(subset.featured.some((entry) => entry.targetId === emptySeriesId)).toBe(true);
    expect(subset.manifest.counts).toEqual(arrayCounts(db));
  });

  it('all-honours-credits: includeCredits=false 时清空鸣谢并重算 counts', () => {
    const { db } = withUnusedEntities();
    const { db: subset } = selectSubset(db, { all: true, includeCredits: false });
    expect(subset.credits).toEqual([]);
    expect(subset.manifest.counts.credits).toBe(0);
  });
});

describe('selectSubset: 部分导出的闭包与词表（B1–B4）', () => {
  it('partial-keeps-vocabulary: 标签与作者全量，未引用图片不进包', () => {
    const { db, unusedTagId, unusedAuthorId, unusedImageId, emptySeriesId } = withUnusedEntities();
    const short = db.articles.find((article) => article.type === 'short');
    if (!short) throw new Error('夹具缺少短篇');

    const { db: subset } = selectSubset(db, { articles: [short.id] });
    expect(subset.tags.map((tag) => tag.id)).toContain(unusedTagId);
    expect(subset.authors.map((author) => author.id)).toContain(unusedAuthorId);
    expect(subset.images.map((image) => image.id)).not.toContain(unusedImageId);
    expect(subset.series.map((series) => series.id)).not.toContain(emptySeriesId);
    expect(subset.featured.some((entry) => entry.targetId === emptySeriesId)).toBe(false);
  });

  it('partial-series-closure: 系列只选一篇时系列本身不进包', () => {
    const { db } = withUnusedEntities();
    const entry = db.articles.find((article) => article.type === 'series-entry');
    if (!entry) throw new Error('夹具缺少系列文章');
    const { db: subset } = selectSubset(db, { articles: [entry.id] });
    expect(subset.articles.map((article) => article.id)).toEqual([entry.id]);
    expect(subset.series).toEqual([]);
  });

  it('partial-warns-missing-refs: 不存在的文章与悬空标签引用都报 W_EXPORT_SKIPPED', () => {
    const { db } = withUnusedEntities();
    const short = db.articles.find((article) => article.type === 'short');
    if (!short) throw new Error('夹具缺少短篇');
    const danglingTag = 't_ffffffffffff';
    const withDangling: RawDatabase = {
      ...db,
      articles: db.articles.map((article) =>
        article.id === short.id
          ? { ...article, characterTagIds: [...(article.characterTagIds ?? []), danglingTag] }
          : article,
      ),
    };

    const { warnings } = selectSubset(withDangling, { articles: ['a_ffffffffffffffff', short.id] });
    expect(warnings.every((issue) => issue.code === 'W_EXPORT_SKIPPED')).toBe(true);
    expect(warnings.some((issue) => issue.message.includes('不存在，已跳过'))).toBe(true);
    expect(warnings.some((issue) => issue.entity === 'tag')).toBe(true);
  });
});
