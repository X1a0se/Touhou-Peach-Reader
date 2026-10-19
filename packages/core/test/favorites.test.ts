import { createMemoryPlatform } from '@tpr/platform/memory';
import { makeArticle, makeDatabase, makeSeries } from '@tpr/schema/testing';
import { describe, expect, it } from 'vitest';
import { createFavorites } from '../src/favorites.js';
import { toSnapshot } from '../src/db/snapshot.js';
import { userPath } from '../src/db/workspace.js';

function setup() {
  const platform = createMemoryPlatform({ dataDir: '/app' });
  const db = makeDatabase({
    articles: [makeArticle({ id: 'a_0000000000000001', title: '收藏文章' })],
    series: [makeSeries({ id: 's_0000000000000001', title: '收藏系列' })],
  });
  const snapshot = toSnapshot(db);
  const favorites = createFavorites(platform, () => 'db_test0001');
  return { platform, favorites, snapshot };
}

describe('favorites: 持久化与失效标记', () => {
  it('toggle 写入 user/{databaseId}.json，新实例重启后仍在', async () => {
    const { platform, favorites } = setup();
    expect(await favorites.toggle('article', 'a_0000000000000001')).toBe(true);
    expect(await favorites.toggle('series', 's_0000000000000001')).toBe(true);

    const file = userPath(platform, 'db_test0001');
    expect(await platform.fs.exists(file)).toBe(true);
    const onDisk = JSON.parse(await platform.fs.readText(file));
    expect(onDisk.favorites).toEqual({
      articles: ['a_0000000000000001'],
      series: ['s_0000000000000001'],
    });

    // 模拟重启：同一 dataDir 上新建服务
    const restarted = createFavorites(platform, () => 'db_test0001');
    await restarted.load();
    expect(restarted.isFavorite('article', 'a_0000000000000001')).toBe(true);
    expect(restarted.isFavorite('series', 's_0000000000000001')).toBe(true);
    expect(restarted.isFavorite('article', 'a_ffffffffffffffff')).toBe(false);
  });

  it('最近收藏排在最前，重复 toggle 取消收藏并落盘', async () => {
    const { platform, favorites } = setup();
    await favorites.toggle('article', 'a_0000000000000001');
    await favorites.toggle('article', 'a_0000000000000002');
    expect(favorites.state().articles).toEqual(['a_0000000000000002', 'a_0000000000000001']);

    expect(await favorites.toggle('article', 'a_0000000000000002')).toBe(false);
    expect(favorites.state().articles).toEqual(['a_0000000000000001']);

    const onDisk = JSON.parse(await platform.fs.readText(userPath(platform, 'db_test0001')));
    expect(onDisk.favorites.articles).toEqual(['a_0000000000000001']);

    await favorites.remove('article', 'a_0000000000000001');
    expect(favorites.state().articles).toEqual([]);
  });

  it('目标被删除时保留收藏并标记 stale，不给出跳转', async () => {
    const { favorites, snapshot } = setup();
    await favorites.toggle('article', 'a_0000000000000001');
    await favorites.toggle('article', 'a_deleted00000000');
    await favorites.toggle('series', 's_gone00000000000');

    const list = favorites.list(snapshot);
    // 后收藏的在前：失效的那条先加入过吗？这里先收 1 再收 deleted，所以 deleted 在最前
    expect(list.articles.map((entry) => entry.stale)).toEqual([true, false]);
    expect(list.articles[0]?.to).toBeNull();
    expect(list.articles[0]?.title).toBe('a_deleted00000000');
    expect(list.articles[1]?.to).toBe('/article/a_0000000000000001');
    expect(list.series[0]?.stale).toBe(true);
  });

  it('没有当前库时不写文件，load 返回空状态', async () => {
    const platform = createMemoryPlatform({ dataDir: '/app' });
    const favorites = createFavorites(platform, () => null);
    expect(await favorites.load()).toEqual({ articles: [], series: [] });
    await favorites.toggle('article', 'a_0000000000000001');
    expect(await platform.fs.exists(userPath(platform, 'db_test0001'))).toBe(false);
  });
});
