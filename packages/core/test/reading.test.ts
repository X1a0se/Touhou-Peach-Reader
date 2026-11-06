import { createMemoryPlatform } from '@tpr/platform/memory';
import { makeDatabase } from '@tpr/schema/testing';
import { describe, expect, it } from 'vitest';
import { toSnapshot } from '../src/db/snapshot.js';
import { userPath } from '../src/db/workspace.js';
import { createReading } from '../src/reading.js';

const DATABASE_ID = 'db_test0001';

function setup() {
  const platform = createMemoryPlatform({ dataDir: '/app' });
  const db = makeDatabase();
  const snapshot = toSnapshot(db);
  const series = db.series[0];
  const article = db.articles.find((item) => item.id === series?.articleIds[0]);
  if (!series || !article) throw new Error('fixture missing series article');
  const reading = createReading(platform, () => DATABASE_ID);
  const file = platform.paths.join(
    platform.paths.dirname(userPath(platform, DATABASE_ID)),
    `${DATABASE_ID}.reading.json`,
  );
  return { platform, snapshot, series, article, reading, file };
}

describe('reading: 书签、上次位置、系列进度与足迹', () => {
  it('reading-persist: 访问/进度/书签落到 user/*.reading.json，重启后能读回', async () => {
    const { platform, snapshot, series, article, reading, file } = setup();
    await reading.load();
    reading.visit({ articleId: article.id, seriesId: series.id, seriesIndex: 1 });
    reading.recordProgress(article.id, 0.42, 640);
    expect(await reading.toggleBookmark(article.id, 0.42, 640)).toBe(true);
    await reading.flush();

    expect(await platform.fs.exists(file)).toBe(true);
    const onDisk = JSON.parse(await platform.fs.readText(file)) as {
      version: number;
      articles: Record<string, { progress: number; bookmark: { scrollY: number } | null }>;
      series: Record<string, { index: number | null }>;
    };
    expect(onDisk.version).toBe(1);
    expect(onDisk.articles[article.id]?.progress).toBe(0.42);
    expect(onDisk.articles[article.id]?.bookmark?.scrollY).toBe(640);
    expect(onDisk.series[series.id]?.index).toBe(1);

    const restarted = createReading(platform, () => DATABASE_ID);
    await restarted.load();
    expect(restarted.article(article.id)).toMatchObject({ progress: 0.42, scrollY: 640 });
    expect(restarted.series(series.id)).toMatchObject({ articleId: article.id, index: 1 });

    const history = restarted.history(snapshot);
    expect(history[0]).toMatchObject({
      articleId: article.id,
      title: article.title,
      progress: 0.42,
      bookmarked: true,
      to: `/article/${article.id}`,
    });
    expect(history[0]?.series).toMatchObject({ id: series.id, index: 1 });

    const bookmarks = restarted.bookmarks(snapshot);
    expect(bookmarks[0]).toMatchObject({ articleId: article.id, title: article.title });
    expect(bookmarks[0]?.bookmarkAt).toBeTruthy();
  });

  it('reading-history: 足迹按最近访问去重排序，记录进度不重排', async () => {
    const { snapshot, series, article, reading } = setup();
    await reading.load();
    const second = snapshot.articles.find((item) => item.id !== article.id && item.seriesId === series.id);
    expect(second).toBeTruthy();

    reading.visit({ articleId: article.id, seriesId: series.id, seriesIndex: 1 });
    reading.visit({ articleId: second?.id ?? '', seriesId: series.id, seriesIndex: 2 });
    expect(reading.history(snapshot).map((item) => item.articleId)).toEqual([
      second?.id,
      article.id,
    ]);

    reading.recordProgress(article.id, 0.8, 1200);
    expect(reading.history(snapshot).map((item) => item.articleId)).toEqual([
      second?.id,
      article.id,
    ]);
    expect(reading.history(snapshot)[1]?.progress).toBe(0.8);

    reading.visit({ articleId: article.id, seriesId: series.id, seriesIndex: 1 });
    expect(reading.history(snapshot).map((item) => item.articleId)).toEqual([
      article.id,
      second?.id,
    ]);
    expect(reading.series(series.id)).toMatchObject({ articleId: article.id, index: 1 });
  });

  it('reading-bookmark: 再次点击取消书签并立即落盘', async () => {
    const { reading, article, snapshot } = setup();
    await reading.load();
    expect(await reading.toggleBookmark(article.id, 0.5, 300)).toBe(true);
    expect(await reading.toggleBookmark(article.id, 0.6, 700)).toBe(false);
    expect(reading.bookmarks(snapshot)).toEqual([]);
    expect(reading.article(article.id)?.bookmark).toBeNull();
  });

  it('reading-switch-database: 切库时把旧进度写回旧文件，不串到新库', async () => {
    const platform = createMemoryPlatform({ dataDir: '/app' });
    let current = 'db_switch_a';
    const reading = createReading(platform, () => current);
    await reading.load();
    reading.visit({ articleId: 'a_00000000000000a1' });
    reading.recordProgress('a_00000000000000a1', 0.35, 480);

    current = 'db_switch_b';
    await reading.load();
    expect(reading.article('a_00000000000000a1')).toBeNull();

    reading.visit({ articleId: 'a_00000000000000b1' });
    reading.recordProgress('a_00000000000000b1', 0.8, 900);
    await reading.flush();

    const pathFor = (id: string) =>
      platform.paths.join(platform.paths.dirname(userPath(platform, id)), `${id}.reading.json`);
    expect(await platform.fs.exists(pathFor('db_switch_a'))).toBe(true);
    expect(await platform.fs.exists(pathFor('db_switch_b'))).toBe(true);

    const fileA = JSON.parse(await platform.fs.readText(pathFor('db_switch_a'))) as {
      articles: Record<string, { progress: number }>;
    };
    const fileB = JSON.parse(await platform.fs.readText(pathFor('db_switch_b'))) as {
      articles: Record<string, { progress: number }>;
    };
    expect(fileA.articles['a_00000000000000a1']?.progress).toBe(0.35);
    expect(fileA.articles['a_00000000000000b1']).toBeUndefined();
    expect(fileB.articles['a_00000000000000b1']?.progress).toBe(0.8);
    expect(fileB.articles['a_00000000000000a1']).toBeUndefined();
  });

  it('reading-no-database: 没有当前库时不写文件', async () => {
    const platform = createMemoryPlatform({ dataDir: '/app' });
    const reading = createReading(platform, () => null);
    await reading.load();
    reading.visit({ articleId: 'a_0000000000000001' });
    await reading.flush();
    expect(await platform.fs.exists('/app/user/db_test0001.reading.json')).toBe(false);
  });
});
