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
  it('reading-persist: 访问/进度/多书签落到 user/*.reading.json，重启后能读回', async () => {
    const { platform, snapshot, series, article, reading, file } = setup();
    await reading.load();
    reading.visit({ articleId: article.id, seriesId: series.id, seriesIndex: 1 });
    reading.recordProgress(article.id, 0.42, 640);
    const bookmark = await reading.addBookmark(article.id, {
      progress: 0.42,
      scrollY: 640,
      label: '这一段',
    });
    expect(bookmark).toMatchObject({ scrollY: 640, label: '这一段' });
    await reading.flush();

    expect(await platform.fs.exists(file)).toBe(true);
    const onDisk = JSON.parse(await platform.fs.readText(file)) as {
      version: number;
      articles: Record<
        string,
        { progress: number; bookmarks: { id: string; scrollY: number; label: string }[] }
      >;
      series: Record<string, { index: number | null }>;
    };
    expect(onDisk.version).toBe(2);
    expect(onDisk.articles[article.id]?.progress).toBe(0.42);
    expect(onDisk.articles[article.id]?.bookmarks[0]).toMatchObject({ scrollY: 640, label: '这一段' });
    expect(onDisk.series[series.id]?.index).toBe(1);

    const restarted = createReading(platform, () => DATABASE_ID);
    await restarted.load();
    expect(restarted.article(article.id)).toMatchObject({ progress: 0.42, scrollY: 640 });
    expect(restarted.article(article.id)?.bookmarks).toHaveLength(1);
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
    expect(bookmarks[0]).toMatchObject({
      articleId: article.id,
      title: article.title,
      label: '这一段',
      scrollY: 640,
    });
    expect(bookmarks[0]?.bookmarkAt).toBeTruthy();
    expect(bookmarks[0]?.to).toBe(`/article/${article.id}?bookmark=${encodeURIComponent(bookmark?.id ?? '')}`);
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

  it('reading-bookmarks: 同一位置更新、不同位置新增、删除立即落盘', async () => {
    const { reading, article, snapshot, platform, file } = setup();
    await reading.load();
    const first = await reading.addBookmark(article.id, { progress: 0.5, scrollY: 300, label: '位置一' });
    expect(first).not.toBeNull();
    expect(reading.bookmarks(snapshot)).toHaveLength(1);

    const updated = await reading.addBookmark(article.id, { progress: 0.52, scrollY: 312, label: '位置一（更新）' });
    expect(updated?.id).toBe(first?.id);
    expect(reading.article(article.id)?.bookmarks).toHaveLength(1);
    expect(reading.article(article.id)?.bookmarks[0]).toMatchObject({ scrollY: 312, label: '位置一（更新）' });

    const second = await reading.addBookmark(article.id, { progress: 0.8, scrollY: 900, label: '位置二' });
    expect(second?.id).not.toBe(first?.id);
    expect(reading.bookmarks(snapshot)).toHaveLength(2);

    await reading.removeBookmark(article.id, first?.id ?? '');
    expect(reading.article(article.id)?.bookmarks).toHaveLength(1);
    expect(reading.bookmarks(snapshot)[0]).toMatchObject({ bookmarkId: second?.id, label: '位置二' });

    const onDisk = JSON.parse(await platform.fs.readText(file)) as {
      articles: Record<string, { bookmarks: { id: string }[] }>;
    };
    expect(onDisk.articles[article.id]?.bookmarks).toHaveLength(1);
    expect(onDisk.articles[article.id]?.bookmarks[0]?.id).toBe(second?.id);
  });

  it('reading-bookmark-migrate: v1 单书签迁移到 v2 书签数组', async () => {
    const { platform, article, reading, file } = setup();
    await platform.fs.mkdir(platform.paths.dirname(file));
    await platform.fs.writeText(
      file,
      JSON.stringify({
        version: 1,
        articles: {
          [article.id]: {
            articleId: article.id,
            seriesId: null,
            progress: 0.3,
            scrollY: 420,
            lastReadAt: '2026-01-02T03:04:05.000Z',
            bookmark: { progress: 0.3, scrollY: 420, at: '2026-01-02T03:04:05.000Z' },
          },
        },
        series: {},
        history: [],
      }),
    );
    await reading.load();
    const bookmarks = reading.article(article.id)?.bookmarks ?? [];
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0]).toMatchObject({ scrollY: 420, label: '', id: 'bm_legacy_2026-01-02T03:04:05.000Z' });
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
