import { describe, expect, it } from 'vitest';
import {
  createDraftEnvelope,
  createDraftStore,
  DraftStorageError,
  draftKey,
  editDraftId,
  findDraftForTarget,
  isEditDraft,
  MAX_DRAFTS,
  MAX_PAYLOAD_CHARS,
  stableSerialize,
  type StorageLike,
} from '../src/editor/drafts.js';

class FakeStorage implements StorageLike {
  readonly map = new Map<string, string>();
  failWrites = false;

  getItem(key: string): string | null {
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

describe('drafts: 草稿箱纯逻辑', () => {
  it('drafts-save-list: 保存后能列出，按更新时间倒序', () => {
    const storage = new FakeStorage();
    const store = createDraftStore(storage, 'db_a');
    const older = createDraftEnvelope('article', '旧草稿', { title: '一' }, 'd1');
    older.updatedAt = '2026-01-01T00:00:00.000Z';
    const newer = createDraftEnvelope('article', '新草稿', { title: '二' }, 'd2');
    newer.updatedAt = '2026-02-01T00:00:00.000Z';
    store.save(older);
    store.save(newer);

    expect(store.list().map((draft) => draft.id)).toEqual(['d2', 'd1']);
    expect(store.list()[0]?.label).toBe('新草稿');
  });

  it('drafts-isolate: 不同 databaseId 互不影响', () => {
    const storage = new FakeStorage();
    const a = createDraftStore(storage, 'db_a');
    const b = createDraftStore(storage, 'db_b');
    a.save(createDraftEnvelope('article', 'A', { title: 'A' }, 'd1'));

    expect(a.list()).toHaveLength(1);
    expect(b.list()).toHaveLength(0);
    expect(storage.map.has(draftKey('db_a'))).toBe(true);
  });

  it('drafts-update: 同 id 保存会覆盖而不是追加', () => {
    const storage = new FakeStorage();
    const store = createDraftStore(storage, 'db_a');
    store.save(createDraftEnvelope('series', '旧标题', { title: '旧' }, 'd1'));
    store.save({ ...createDraftEnvelope('series', '新标题', { title: '新' }, 'd1') });

    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]?.label).toBe('新标题');
  });

  it('drafts-prune: 超过 MAX_DRAFTS 时保留最新的 N 条', () => {
    const storage = new FakeStorage();
    const store = createDraftStore(storage, 'db_a');
    for (let index = 0; index < MAX_DRAFTS + 3; index += 1) {
      const draft = createDraftEnvelope('tag', `草稿 ${index}`, { name: `t${index}` }, `d${index}`);
      draft.updatedAt = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
      store.save(draft);
    }

    const list = store.list();
    expect(list).toHaveLength(MAX_DRAFTS);
    expect(list[0]?.label).toBe(`草稿 ${MAX_DRAFTS + 2}`);
    expect(list.some((draft) => draft.label === '草稿 0')).toBe(false);
  });

  it('drafts-too-large: payload 超过上限抛 E_TOO_LARGE', () => {
    const storage = new FakeStorage();
    const store = createDraftStore(storage, 'db_a');
    const huge = { content: 'x'.repeat(MAX_PAYLOAD_CHARS + 10) };

    expect(() => store.save(createDraftEnvelope('article', '太大', huge, 'd1'))).toThrow(DraftStorageError);
    try {
      store.save(createDraftEnvelope('article', '太大', huge, 'd1'));
    } catch (error) {
      expect((error as DraftStorageError).code).toBe('E_TOO_LARGE');
    }
  });

  it('drafts-quota: storage 写入失败时抛 E_QUOTA，且提示中文', () => {
    const storage = new FakeStorage();
    const store = createDraftStore(storage, 'db_a');
    storage.failWrites = true;

    try {
      store.save(createDraftEnvelope('tag', '标签', { name: 'x' }, 'd1'));
      throw new Error('应当抛错');
    } catch (error) {
      expect(error).toBeInstanceOf(DraftStorageError);
      expect((error as DraftStorageError).code).toBe('E_QUOTA');
      expect((error as DraftStorageError).message).toContain('空间不足');
    }
  });

  it('drafts-corrupt: 存储里是坏 JSON 时当作空列表', () => {
    const storage = new FakeStorage();
    storage.map.set(draftKey('db_a'), '{not json');
    const store = createDraftStore(storage, 'db_a');

    expect(store.list()).toEqual([]);
  });

  it('drafts-edit-id: 编辑草稿 id 稳定且带 targetId', () => {
    expect(editDraftId('article', 'a_0000000000000001')).toBe('edit:article:a_0000000000000001');
    expect(editDraftId('article', 'a_0000000000000001')).toBe(editDraftId('article', 'a_0000000000000001'));
    expect(editDraftId('series', 's_0000000000000001')).toBe('edit:series:s_0000000000000001');
  });

  it('drafts-target-roundtrip: targetId 可往返，旧 envelope 仍可读', () => {
    const storage = new FakeStorage();
    const store = createDraftStore(storage, 'db_a');
    const draft = createDraftEnvelope('article', '编辑', { title: '改' }, 'edit:article:a1', 'a1');
    store.save(draft);

    const found = store.list()[0];
    expect(found?.targetId).toBe('a1');
    expect(isEditDraft(found!)).toBe(true);
    expect(findDraftForTarget(store.list(), 'article', 'a1')?.id).toBe('edit:article:a1');
    expect(findDraftForTarget(store.list(), 'series', 'a1')).toBeUndefined();

    // 模拟旧版本写下的草稿：没有 targetId 字段
    const legacy = {
      v: 1,
      id: 'legacy',
      kind: 'article',
      label: '旧草稿',
      updatedAt: '2026-01-01T00:00:00.000Z',
      payload: { title: '旧' },
    };
    storage.map.set(draftKey('db_a'), JSON.stringify([legacy]));
    const legacyStore = createDraftStore(storage, 'db_a');
    expect(legacyStore.list()).toHaveLength(1);
    expect(legacyStore.list()[0]?.targetId).toBeUndefined();
    expect(isEditDraft(legacyStore.list()[0]!)).toBe(false);
  });

  it('drafts-stable-serialize: 忽略对象 key 顺序，保留数组顺序', () => {
    expect(stableSerialize({ a: 1, b: [2, 3] })).toBe(stableSerialize({ b: [2, 3], a: 1 }));
    expect(stableSerialize({ a: [1, 2] })).not.toBe(stableSerialize({ a: [2, 1] }));
    expect(stableSerialize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('drafts-remove-clear: 删除单条与清空整箱', () => {
    const storage = new FakeStorage();
    const store = createDraftStore(storage, 'db_a');
    store.save(createDraftEnvelope('tag', 'A', { name: 'a' }, 'd1'));
    store.save(createDraftEnvelope('tag', 'B', { name: 'b' }, 'd2'));

    store.remove('d1');
    expect(store.list().map((draft) => draft.id)).toEqual(['d2']);
    store.clear();
    expect(store.list()).toEqual([]);
  });
});
