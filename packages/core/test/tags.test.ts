import { createMemoryPlatform } from '@tpr/platform/memory';
import { makeDatabase } from '@tpr/schema/testing';
import { describe, expect, it } from 'vitest';
import { getFeaturedCards } from '../src/db/featured.js';
import { toSnapshot } from '../src/db/snapshot.js';
import { getArticleView, resolveTags } from '../src/db/view.js';
import { createFavorites } from '../src/favorites.js';

const join = (...parts: string[]): string => parts.join('/');
const opts = { dir: 'ws/db_0001', join };

describe('resolveTags', () => {
  it('按传入顺序解析、去重并跳过悬空 id', () => {
    const snapshot = toSnapshot(makeDatabase());
    const character = snapshot.tags.find((tag) => tag.category === 'character');
    const plot = snapshot.tags.find((tag) => tag.category === 'plot');
    expect(character && plot).toBeTruthy();

    const resolved = resolveTags(snapshot, [
      character?.id ?? '',
      plot?.id ?? '',
      character?.id ?? '',
      't_ffffffffffffffff',
    ]);
    expect(resolved.map((tag) => tag.id)).toEqual([character?.id, plot?.id]);
    expect(resolved.map((tag) => tag.category)).toEqual(['character', 'plot']);
  });

  it('undefined 与空数组都返回空列表', () => {
    const snapshot = toSnapshot(makeDatabase());
    expect(resolveTags(snapshot, undefined)).toEqual([]);
    expect(resolveTags(snapshot, [])).toEqual([]);
  });
});

describe('视图与卡片上的标签', () => {
  it('文章视图同时带角色与情节标签', () => {
    const snapshot = toSnapshot(makeDatabase());
    const entry = snapshot.articles.find((article) => article.title === '系列第一篇');
    const view = getArticleView(snapshot, entry?.id ?? '', opts);
    expect(view?.characterTags.map((tag) => tag.name)).toEqual(['雾雨魔理沙']);
    expect(view?.plotTags.map((tag) => tag.name)).toEqual(['红魔馆']);
  });

  it('精选卡片带目标标签，失效条目为空数组', () => {
    const db = makeDatabase();
    const seriesId = db.series[0]?.id ?? '';
    db.featured = [
      { targetType: 'series', targetId: seriesId, recommendations: [{ text: '带标签的系列' }] },
      { targetType: 'series', targetId: 's_ffffffffffffffff', recommendations: [] },
    ];
    const cards = getFeaturedCards(toSnapshot(db), opts, 'series');
    expect(cards[0]?.tags.map((tag) => tag.name)).toEqual(['雾雨魔理沙']);
    expect(cards[1]?.status).toBe('missing');
    expect(cards[1]?.tags).toEqual([]);
  });

  it('收藏条目带标签，失效条目标记为 stale 且没有标签', async () => {
    const platform = createMemoryPlatform({ dataDir: '/app' });
    const snapshot = toSnapshot(makeDatabase());
    const short = snapshot.articles.find((article) => article.type === 'short');
    const series = snapshot.series[0];
    expect(short && series).toBeTruthy();

    const favorites = createFavorites(platform, () => 'db_test0001');
    await favorites.toggle('article', short?.id ?? '');
    await favorites.toggle('article', 'a_ffffffffffffffff');
    await favorites.toggle('series', series?.id ?? '');

    const entries = favorites.list(snapshot);
    const valid = entries.articles.find((entry) => entry.id === short?.id);
    const stale = entries.articles.find((entry) => entry.id === 'a_ffffffffffffffff');
    const seriesEntry = entries.series.find((entry) => entry.id === series?.id);
    expect(valid?.tags.map((tag) => tag.name)).toEqual(['雾雨魔理沙']);
    expect(seriesEntry?.tags.map((tag) => tag.name)).toEqual(['雾雨魔理沙']);
    expect(stale?.stale).toBe(true);
    expect(stale?.tags).toEqual([]);
  });
});
