import { describe, expect, it } from 'vitest';
import {
  articleUsage,
  createRecentStore,
  MAX_RECENT_PER_BUCKET,
  normalizeRecent,
  orderByRecent,
  recentKey,
  type StorageLike,
  seriesUsage,
} from '../src/editor/recent.js';

class FakeStorage implements StorageLike {
  readonly map = new Map<string, string>();
  failWrites = false;
  failReads = false;

  getItem(key: string): string | null {
    if (this.failReads) throw new Error('SecurityError: storage disabled');
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) {
      const error = new Error('QuotaExceededError: exceeded the quota');
      error.name = 'QuotaExceededError';
      throw error;
    }
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

describe('recent: 最近使用排序纯逻辑', () => {
  it('recent-key: 按库隔离，空库名退化成 _none', () => {
    expect(recentKey('db_a')).toBe('tpr:recent:v1:db_a');
    expect(recentKey('')).toBe('tpr:recent:v1:_none');
  });

  it('recent-touch: 最近 touch 的排最前，重复 touch 会提到最前且不重复', () => {
    const storage = new FakeStorage();
    const store = createRecentStore(storage, 'db_a');
    store.touch('author', ['a1', 'a2']);
    expect(store.list('author')).toEqual(['a1', 'a2']);

    store.touch('author', ['a2']);
    expect(store.list('author')).toEqual(['a2', 'a1']);

    store.touch('author', ['a2', 'a2', 'a3']);
    expect(store.list('author')).toEqual(['a2', 'a3', 'a1']);
  });

  it('recent-isolate: 不同 databaseId 与不同桶互不影响', () => {
    const storage = new FakeStorage();
    const a = createRecentStore(storage, 'db_a');
    const b = createRecentStore(storage, 'db_b');
    a.touch('author', ['a1']);
    a.touch('image', ['i1']);

    expect(a.list('author')).toEqual(['a1']);
    expect(a.list('image')).toEqual(['i1']);
    expect(a.list('translator')).toEqual([]);
    expect(b.list('author')).toEqual([]);
    expect(storage.map.has(recentKey('db_a'))).toBe(true);
  });

  it('recent-trim: 超过上限时只保留最近的 N 条', () => {
    const storage = new FakeStorage();
    const store = createRecentStore(storage, 'db_a');
    const ids = Array.from({ length: MAX_RECENT_PER_BUCKET + 5 }, (_, index) => `a${index}`);
    for (const id of ids) store.touch('author', [id]);

    const list = store.list('author');
    expect(list).toHaveLength(MAX_RECENT_PER_BUCKET);
    expect(list[0]).toBe(ids.at(-1));
    expect(list).not.toContain(ids[0]);
  });

  it('recent-forget: 从所有桶里移除，其余项顺序不变', () => {
    const storage = new FakeStorage();
    const store = createRecentStore(storage, 'db_a');
    store.touch('author', ['a1', 'a2', 'a3']);
    store.touch('image', ['a2', 'i1']);

    store.forget(['a2']);
    expect(store.list('author')).toEqual(['a1', 'a3']);
    expect(store.list('image')).toEqual(['i1']);

    store.forget(['not-there']);
    expect(store.list('author')).toEqual(['a1', 'a3']);
  });

  it('recent-empty-ops: 空 id / 空数组是空操作，不写存储', () => {
    const storage = new FakeStorage();
    const store = createRecentStore(storage, 'db_a');
    store.touch('author', []);
    store.touch('series', ['']);
    store.touch('series', ['   ']);
    store.forget([]);

    expect(storage.map.size).toBe(0);
  });

  it('recent-corrupt: 坏 JSON / 错误形状都退化成空记录', () => {
    const storage = new FakeStorage();
    storage.map.set(recentKey('db_a'), '{not json');
    expect(createRecentStore(storage, 'db_a').list('author')).toEqual([]);

    storage.map.set(recentKey('db_a'), JSON.stringify(['a1']));
    expect(createRecentStore(storage, 'db_a').list('author')).toEqual([]);

    storage.map.set(recentKey('db_a'), JSON.stringify({ author: 'a1', unknown: ['x'] }));
    expect(createRecentStore(storage, 'db_a').list('author')).toEqual([]);
    expect(normalizeRecent({ author: ['a1', 42, 'a1', ''] })).toEqual({ author: ['a1'] });
  });

  it('recent-disabled-storage: 读/写抛错时静默降级，不阻断调用方', () => {
    const storage = new FakeStorage();
    storage.failReads = true;
    const store = createRecentStore(storage, 'db_a');
    expect(() => store.touch('author', ['a1'])).not.toThrow();
    expect(store.list('author')).toEqual([]);

    storage.failReads = false;
    storage.failWrites = true;
    expect(() => store.touch('author', ['a1'])).not.toThrow();
    expect(() => store.forget(['a1'])).not.toThrow();
    expect(() => store.clear()).not.toThrow();
  });

  it('recent-clear: 清空后没有记录', () => {
    const storage = new FakeStorage();
    const store = createRecentStore(storage, 'db_a');
    store.touch('author', ['a1']);
    store.clear();
    expect(store.list('author')).toEqual([]);
    expect(storage.map.has(recentKey('db_a'))).toBe(false);
  });

  it('recent-order: 最近使用的排前，其余保持原顺序，未知 id 忽略', () => {
    const items = [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }];
    expect(orderByRecent(items, []).map((item) => item.id)).toEqual(['a1', 'a2', 'a3']);
    expect(orderByRecent(items, ['a3']).map((item) => item.id)).toEqual(['a3', 'a1', 'a2']);
    expect(orderByRecent(items, ['a2', 'a3', 'ghost']).map((item) => item.id)).toEqual([
      'a2',
      'a3',
      'a1',
    ]);
    // 不改入参
    expect(items.map((item) => item.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('recent-article-usage: 文章保存后记作者/译者/系列/角色/情节/封面与插图', () => {
    const usage = articleUsage({
      authorIds: ['au1', 'au2'],
      translatorIds: ['au3'],
      characterTagIds: ['t1'],
      plotTagIds: ['t2'],
      seriesId: 's1',
      coverImageId: 'i1',
      illustrationImageIds: ['i2', 'i1'],
    });
    expect(usage).toEqual([
      { bucket: 'author', ids: ['au1', 'au2'] },
      { bucket: 'translator', ids: ['au3'] },
      { bucket: 'series', ids: ['s1'] },
      { bucket: 'tag:character', ids: ['t1'] },
      { bucket: 'tag:plot', ids: ['t2'] },
      { bucket: 'image', ids: ['i1', 'i2'] },
    ]);
  });

  it('recent-article-usage-empty: 空 id 不产生条目，也没选系列时不出 series 桶', () => {
    expect(articleUsage({})).toEqual([]);
    expect(articleUsage({ seriesId: '', coverImageId: null, authorIds: ['', '  '] })).toEqual([]);
  });

  it('recent-series-usage: 系列保存不记 series 桶', () => {
    const usage = seriesUsage({
      authorIds: ['au1'],
      translatorIds: ['au2'],
      characterTagIds: ['t1'],
      plotTagIds: ['t2'],
      coverImageId: 'i1',
      illustrationImageIds: ['i2'],
    });
    expect(usage.map((entry) => entry.bucket)).toEqual([
      'author',
      'translator',
      'tag:character',
      'tag:plot',
      'image',
    ]);
  });
});
