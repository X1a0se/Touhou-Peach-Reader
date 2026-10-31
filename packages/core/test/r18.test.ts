import { createMemoryPlatform } from '@tpr/platform/memory';
import {
  makeArticle,
  makeDatabase,
  makeFeatured,
  makeSeries,
  makeTag,
} from '@tpr/schema/testing';
import { describe, expect, it } from 'vitest';
import { createFavorites } from '../src/favorites.js';
import { getFeaturedCards } from '../src/db/featured.js';
import { toSnapshot } from '../src/db/snapshot.js';
import { hasR18PlotTag } from '../src/db/view.js';

const join = (...parts: string[]): string => parts.join('/');
const opts = { dir: 'ws/db_0001', join };

function fixture() {
  const plotR18 = makeTag({ category: 'plot', name: 'R18' });
  const characterR18 = makeTag({ category: 'character', name: 'R18' });
  const normal = makeTag({ category: 'plot', name: '日常' });
  const short = makeArticle({ title: 'R18 短篇', plotTagIds: [plotR18.id] });
  const normalShort = makeArticle({ title: '一般短篇', plotTagIds: [normal.id] });
  const series = makeSeries({ title: 'R18 系列', plotTagIds: [plotR18.id], articleIds: [] });
  const db = makeDatabase(
    {
      tags: [plotR18, characterR18, normal],
      articles: [short, normalShort],
      series: [series],
      featured: [
        makeFeatured({ targetType: 'article', targetId: short.id }),
        makeFeatured({ targetType: 'article', targetId: normalShort.id }),
        makeFeatured({ targetType: 'series', targetId: series.id }),
      ],
    },
    { withFiles: true },
  );
  return { db, plotR18, characterR18, short, normalShort, series };
}

describe('hasR18PlotTag', () => {
  it('只认情节类别里的 R18，忽略角色标签与悬空 id', () => {
    const { db, plotR18, characterR18, short } = fixture();
    const snapshot = toSnapshot(db);
    expect(hasR18PlotTag(snapshot, short.plotTagIds)).toBe(true);
    expect(hasR18PlotTag(snapshot, [characterR18.id])).toBe(false);
    expect(hasR18PlotTag(snapshot, ['t_ffffffffffffffff'])).toBe(false);
    expect(hasR18PlotTag(snapshot, [plotR18.id, plotR18.id])).toBe(true);
    expect(hasR18PlotTag(snapshot, undefined)).toBe(false);
  });
});

describe('精选/收藏的 R18 标记', () => {
  it('精选卡片携带 r18，失效条目为 false', () => {
    const { db, short, normalShort, series } = fixture();
    const snapshot = toSnapshot(db);
    const shortCards = getFeaturedCards(snapshot, opts, 'short');
    expect(shortCards.find((card) => card.targetId === short.id)?.r18).toBe(true);
    expect(shortCards.find((card) => card.targetId === normalShort.id)?.r18).toBe(false);

    const seriesCards = getFeaturedCards(snapshot, opts, 'series');
    expect(seriesCards.find((card) => card.targetId === series.id)?.r18).toBe(true);

    const missing = getFeaturedCards(
      toSnapshot(makeDatabase({ featured: [makeFeatured({ targetType: 'article', targetId: 'a_ffffffffffffffff' })] })),
      opts,
      'short',
    );
    expect(missing[0]?.r18).toBe(false);
  });

  it('收藏条目携带 r18，失效条目为 false', async () => {
    const { db, short, series } = fixture();
    const platform = createMemoryPlatform({ dataDir: '/app' });
    const favorites = createFavorites(platform, () => 'db_test0001');
    await favorites.toggle('article', short.id);
    await favorites.toggle('article', 'a_ffffffffffffffff');
    await favorites.toggle('series', series.id);
    const list = favorites.list(toSnapshot(db));
    expect(list.articles.find((entry) => entry.id === short.id)?.r18).toBe(true);
    expect(list.articles.find((entry) => entry.id === 'a_ffffffffffffffff')?.r18).toBe(false);
    expect(list.series.find((entry) => entry.id === series.id)?.r18).toBe(true);
  });
});
