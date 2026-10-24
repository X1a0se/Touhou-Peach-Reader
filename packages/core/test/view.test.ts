import { makeArticle, makeAuthor, makeDatabase, makeImage, makeSeries, makeTag } from '@tpr/schema/testing';
import { describe, expect, it } from 'vitest';
import { toSnapshot } from '../src/db/snapshot.js';
import { articleSeriesPosition, getArticleNeighbors, getArticleView, getSeriesView } from '../src/db/view.js';

// 不用 node:path：core 的 tsconfig 不带 node 类型，测试里保持纯字符串拼接
const join = (...parts: string[]): string => parts.join('/');
const dir = 'ws/db_0001';
const opts = { dir, join };

function fixture() {
  const author = makeAuthor({ canonicalName: '雾雨魔理沙', aliases: ['魔理沙', 'Marisa'] });
  const translator = makeAuthor({ canonicalName: '译者甲' });
  const characterTag = makeTag({ category: 'character', name: '博丽灵梦' });
  const plotTag = makeTag({ category: 'plot', name: '日常' });
  const cover = makeImage({ id: 'i_0000000000000001', kind: 'cover', file: 'images/cover/c.webp' });
  const illustration = makeImage({
    id: 'i_0000000000000002',
    kind: 'illustration',
    file: 'images/illustration/i.webp',
    caption: '插图一',
  });
  const series = makeSeries({ id: 's_0000000000000001', title: '星之系列', articleIds: [] });
  const second = makeArticle({
    id: 'a_0000000000000002',
    title: '系列第二篇',
    type: 'series-entry',
    seriesId: series.id,
    authorIds: [author.id],
    translatorIds: [translator.id],
    characterTagIds: [characterTag.id],
    plotTagIds: [plotTag.id],
    illustrationImageIds: [illustration.id],
    coverImageId: cover.id,
    sourceUrl: 'https://example.com/post/2',
    updatedAt: '2026-01-02T00:00:00.000Z',
  });
  const first = makeArticle({
    id: 'a_0000000000000001',
    title: '系列第一篇',
    type: 'series-entry',
    seriesId: series.id,
    updatedAt: '2026-02-02T00:00:00.000Z',
  });
  const db = makeDatabase(
    {
      authors: [author, translator],
      tags: [characterTag, plotTag],
      images: [cover, illustration],
      articles: [first, second],
      series: [
        {
          ...series,
          articleIds: [second.id, 'a_ffffffffffffffff', first.id],
          translatorIds: [translator.id],
        },
      ],
    },
    { withFiles: true },
  );
  return { db, author, translator, characterTag, plotTag, cover, illustration };
}

describe('getArticleView', () => {
  it('解析作者/译者/标签/图片/系列与序号', () => {
    const { db, author, translator, characterTag, plotTag, cover, illustration } = fixture();
    const view = getArticleView(toSnapshot(db), 'a_0000000000000002', opts);
    expect(view).not.toBeNull();
    if (!view) return;

    expect(view.article.title).toBe('系列第二篇');
    expect(view.authors).toEqual([{ id: author.id, name: '雾雨魔理沙', aliases: ['魔理沙', 'Marisa'] }]);
    expect(view.translators.map((p) => p.name)).toEqual(['译者甲']);
    expect(view.characterTags).toEqual([{ id: characterTag.id, name: '博丽灵梦', category: 'character' }]);
    expect(view.plotTags).toEqual([{ id: plotTag.id, name: '日常', category: 'plot' }]);
    // articleIds = [second, missing, first] → second 是第 1 篇
    expect(view.series).toEqual({ id: 's_0000000000000001', title: '星之系列', status: 'ongoing', index: 1 });
    expect(view.cover).toEqual({
      id: cover.id,
      file: 'images/cover/c.webp',
      kind: 'cover',
      caption: null,
      path: join(dir, 'images/cover/c.webp'),
    });
    expect(view.illustrations).toHaveLength(1);
    expect(view.illustrations[0]?.caption).toBe('插图一');
    expect(view.illustrations[0]?.path).toBe(join(dir, 'images/illustration/i.webp'));
    expect(view.sourceUrl).toBe('https://example.com/post/2');
  });

  it('短篇没有系列与图片时返回空数组/null', () => {
    const { db } = fixture();
    const view = getArticleView(toSnapshot(db), 'a_0000000000000001', opts);
    expect(view).not.toBeNull();
    if (!view) return;
    expect(view.series?.index).toBe(3);
    expect(view.cover).toBeNull();
    expect(view.illustrations).toEqual([]);
    expect(view.sourceUrl).toBeNull();
  });

  it('未知 id 返回 null', () => {
    const { db } = fixture();
    expect(getArticleView(toSnapshot(db), 'a_ffffffffffffffff', opts)).toBeNull();
  });
});

describe('getSeriesView', () => {
  it('按 articleIds 顺序返回、跳过缺失文章', () => {
    const { db } = fixture();
    const view = getSeriesView(toSnapshot(db), 's_0000000000000001', opts);
    expect(view).not.toBeNull();
    if (!view) return;
    expect(view.series.title).toBe('星之系列');
    expect(view.articles.map((a) => a.title)).toEqual(['系列第二篇', '系列第一篇']);
    expect(view.translators.map((person) => person.name)).toEqual(['译者甲']);
  });

  it('未知 id 返回 null', () => {
    const { db } = fixture();
    expect(getSeriesView(toSnapshot(db), 's_ffffffffffffffff', opts)).toBeNull();
  });
});

describe('articleSeriesPosition', () => {
  it('返回 1 基编号与所属系列', () => {
    const { db } = fixture();
    const snapshot = toSnapshot(db);
    // articleIds = [second, missing, first]：second 第 1，first 第 3
    expect(articleSeriesPosition(snapshot, 'a_0000000000000002')?.index).toBe(1);
    expect(articleSeriesPosition(snapshot, 'a_0000000000000001')?.index).toBe(3);
    expect(articleSeriesPosition(snapshot, 'a_0000000000000001')?.series.title).toBe('星之系列');
  });

  it('不在目录里的文章、未知文章都返回 null', () => {
    const { db } = fixture();
    const snapshot = toSnapshot(db);
    expect(articleSeriesPosition(snapshot, 'a_ffffffffffffffff')).toBeNull();
    // 文章标了 seriesId，但目录里没有它（旧版本编辑器会造成这种数据）
    const orphan = makeArticle({
      id: 'a_0000000000000003',
      title: '目录外文章',
      type: 'series-entry',
      seriesId: 's_0000000000000001',
    });
    const snapshot2 = toSnapshot(
      makeDatabase(
        { articles: [...db.articles, orphan], series: db.series },
        { withFiles: true },
      ),
    );
    expect(articleSeriesPosition(snapshot2, orphan.id)).toBeNull();
  });
});

describe('getArticleNeighbors', () => {
  it('按 articleIds 顺序返回前后篇，并跳过缺失文章', () => {
    const { db } = fixture();
    const snapshot = toSnapshot(db);

    const second = getArticleNeighbors(snapshot, 'a_0000000000000002');
    expect(second?.series.id).toBe('s_0000000000000001');
    expect(second?.previous).toBeNull();
    expect(second?.next?.id).toBe('a_0000000000000001');

    const first = getArticleNeighbors(snapshot, 'a_0000000000000001');
    expect(first?.previous?.id).toBe('a_0000000000000002');
    expect(first?.next).toBeNull();
  });

  it('短篇、未知文章、目录外文章与未知系列都返回 null', () => {
    const snapshot = toSnapshot(makeDatabase());
    const short = snapshot.articles.find((article) => article.type === 'short');
    expect(short).toBeTruthy();
    if (!short) return;
    expect(getArticleNeighbors(snapshot, short.id)).toBeNull();
    expect(getArticleNeighbors(snapshot, 'a_ffffffffffffffff')).toBeNull();

    const db = makeDatabase();
    const series = db.series[0];
    expect(series).toBeTruthy();
    if (!series) return;
    const orphan = makeArticle({
      id: 'a_0000000000000003',
      title: '目录外文章',
      type: 'series-entry',
      seriesId: series.id,
    });
    const snapshot2 = toSnapshot({ ...db, articles: [...db.articles, orphan] });
    expect(getArticleNeighbors(snapshot2, orphan.id)).toBeNull();

    const dangling = makeArticle({
      id: 'a_0000000000000004',
      title: '悬空系列文章',
      type: 'series-entry',
      seriesId: 's_ffffffffffffffff',
    });
    const snapshot3 = toSnapshot({ ...db, articles: [...db.articles, dangling] });
    expect(getArticleNeighbors(snapshot3, dangling.id)).toBeNull();
  });

  it('单篇系列的前后篇都是 null', () => {
    const db = makeDatabase();
    const series = db.series[0];
    expect(series).toBeTruthy();
    if (!series) return;
    const onlyId = series.articleIds[0];
    expect(onlyId).toBeTruthy();
    if (!onlyId) return;
    db.series = [{ ...series, articleIds: [onlyId] }];
    const snapshot = toSnapshot(db);

    const neighbors = getArticleNeighbors(snapshot, onlyId);
    expect(neighbors?.previous).toBeNull();
    expect(neighbors?.next).toBeNull();
    expect(neighbors?.series.id).toBe(series.id);
  });
});
