/**
 * 编辑器「最近使用」排序。
 *
 * 只记本机：写在 WebView 的 `localStorage`，键为 `tpr:recent:v1:{databaseId}`，
 * 与草稿箱同一套隔离约定——按库分开、不随数据库导出、换机不迁移。
 *
 * 与草稿箱的关键差别是**失败一律静默**：这里只是排序提示，不是数据。
 * 存储被禁用、配额满、内容损坏都退化成「没有最近记录」，绝不阻断保存实体。
 */

import type { StorageLike } from './drafts.js';

export const RECENT_KEY_PREFIX = 'tpr:recent:v1:';
/** 每个桶最多记多少条：只影响列表前 30 个，防止长期使用把 localStorage 撑大 */
export const MAX_RECENT_PER_BUCKET = 30;
/** 单条 id 的长度上限（现有 id 都是 18 位以内，留足余量） */
const MAX_ID_LENGTH = 64;

export const RECENT_BUCKETS = [
  'author',
  'translator',
  'series',
  'tag:character',
  'tag:plot',
  'image',
] as const;

export type RecentBucket = (typeof RECENT_BUCKETS)[number];

export type RecentUsage = Record<string, string[]>;

export function recentKey(databaseId: string): string {
  return `${RECENT_KEY_PREFIX}${databaseId || '_none'}`;
}

const isBucket = (value: string): value is RecentBucket =>
  (RECENT_BUCKETS as readonly string[]).includes(value);

function cleanId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  if (id === '' || id.length > MAX_ID_LENGTH) return null;
  return id;
}

/**
 * 宽容解析：只保留已知桶、只收非空字符串、去重并截断到 `MAX_RECENT_PER_BUCKET`。
 * 任何形状不对的输入都当作空记录，不抛错。
 */
export function normalizeRecent(value: unknown): RecentUsage {
  const out: RecentUsage = {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [bucket, items] of Object.entries(value as Record<string, unknown>)) {
    if (!isBucket(bucket) || !Array.isArray(items)) continue;
    const seen: string[] = [];
    for (const item of items) {
      const id = cleanId(item);
      if (id === null || seen.includes(id)) continue;
      seen.push(id);
      if (seen.length >= MAX_RECENT_PER_BUCKET) break;
    }
    if (seen.length > 0) out[bucket] = seen;
  }
  return out;
}

export interface RecentStore {
  readonly databaseId: string;
  /** 最近使用在前；没有记录时返回空数组 */
  list(bucket: RecentBucket): string[];
  /** 整份记录的快照（供 React 状态同步用；调用方不应修改） */
  snapshot(): RecentUsage;
  /** 把 ids 提到该桶最前（数组顺序即最近程度），空数组/空串是空操作 */
  touch(bucket: RecentBucket, ids: readonly string[]): void;
  /** 从所有桶里移除这些 id（删除实体后调用） */
  forget(ids: readonly string[]): void;
  clear(): void;
}

export function createRecentStore(storage: StorageLike, databaseId: string): RecentStore {
  const key = recentKey(databaseId);

  const read = (): RecentUsage => {
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch {
      return {};
    }
    if (!raw) return {};
    try {
      return normalizeRecent(JSON.parse(raw) as unknown);
    } catch {
      return {};
    }
  };

  const write = (usage: RecentUsage): void => {
    try {
      storage.setItem(key, JSON.stringify(usage));
    } catch {
      // 配额满 / 存储被禁用：排序提示静默失效，不影响保存实体
    }
  };

  return {
    databaseId,
    list(bucket) {
      return read()[bucket] ?? [];
    },
    snapshot() {
      return read();
    },
    touch(bucket, ids) {
      const fresh = [...new Set(ids.map(cleanId).filter((id): id is string => id !== null))];
      if (fresh.length === 0) return;
      const usage = read();
      const current = usage[bucket] ?? [];
      const next = [...fresh, ...current.filter((id) => !fresh.includes(id))].slice(
        0,
        MAX_RECENT_PER_BUCKET,
      );
      write({ ...usage, [bucket]: next });
    },
    forget(ids) {
      const drop = new Set(ids.map(cleanId).filter((id): id is string => id !== null));
      if (drop.size === 0) return;
      const usage = read();
      let changed = false;
      const next: RecentUsage = {};
      for (const [bucket, items] of Object.entries(usage)) {
        const kept = items.filter((id) => !drop.has(id));
        if (kept.length === items.length) {
          next[bucket] = items;
          continue;
        }
        changed = true;
        if (kept.length > 0) next[bucket] = kept;
      }
      if (changed) write(next);
    },
    clear() {
      try {
        storage.removeItem(key);
      } catch {
        // 存储不可用时视为已清空
      }
    },
  };
}

/**
 * 最近使用优先排序：先按 `order` 出现的先后排，其余项保持传入顺序。
 * 稳定、不修改入参；`order` 里不在 `items` 中的 id 直接忽略。
 */
export function orderByRecent<T extends { id: string }>(
  items: readonly T[],
  order: readonly string[],
): T[] {
  if (order.length === 0) return [...items];
  const rank = new Map<string, number>();
  for (const id of order) {
    if (!rank.has(id)) rank.set(id, rank.size);
  }
  return items
    .map((item, index) => ({ item, index, rank: rank.get(item.id) }))
    .sort((a, b) => {
      if (a.rank !== undefined && b.rank !== undefined) return a.rank - b.rank;
      if (a.rank !== undefined) return -1;
      if (b.rank !== undefined) return 1;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

/** 一次保存要记下的全部桶：空 id / 空数组不产生条目 */
export interface RecentTouch {
  bucket: RecentBucket;
  ids: string[];
}

const compact = (ids: readonly (string | undefined)[]): string[] => {
  const out: string[] = [];
  for (const id of ids) {
    const clean = cleanId(id);
    if (clean !== null && !out.includes(clean)) out.push(clean);
  }
  return out;
};

function push(
  touches: RecentTouch[],
  bucket: RecentBucket,
  ids: readonly (string | undefined)[],
): void {
  const clean = compact(ids);
  if (clean.length > 0) touches.push({ bucket, ids: clean });
}

/** 文章保存成功后要记的作者 / 译者 / 系列 / 角色标签 / 情节标签 / 封面与插图 */
export function articleUsage(draft: {
  authorIds?: readonly string[] | undefined;
  translatorIds?: readonly string[] | undefined;
  characterTagIds?: readonly string[] | undefined;
  plotTagIds?: readonly string[] | undefined;
  seriesId?: string | null | undefined;
  coverImageId?: string | null | undefined;
  illustrationImageIds?: readonly string[] | undefined;
}): RecentTouch[] {
  const touches: RecentTouch[] = [];
  push(touches, 'author', draft.authorIds ?? []);
  push(touches, 'translator', draft.translatorIds ?? []);
  push(touches, 'series', [draft.seriesId ?? '']);
  push(touches, 'tag:character', draft.characterTagIds ?? []);
  push(touches, 'tag:plot', draft.plotTagIds ?? []);
  push(touches, 'image', [draft.coverImageId ?? '', ...(draft.illustrationImageIds ?? [])]);
  return touches;
}

/** 系列保存成功后要记的桶（系列没有下拉里的「系列」桶，也没有插图以外的新桶） */
export function seriesUsage(draft: {
  authorIds?: readonly string[] | undefined;
  translatorIds?: readonly string[] | undefined;
  characterTagIds?: readonly string[] | undefined;
  plotTagIds?: readonly string[] | undefined;
  coverImageId?: string | null | undefined;
  illustrationImageIds?: readonly string[] | undefined;
}): RecentTouch[] {
  const touches: RecentTouch[] = [];
  push(touches, 'author', draft.authorIds ?? []);
  push(touches, 'translator', draft.translatorIds ?? []);
  push(touches, 'tag:character', draft.characterTagIds ?? []);
  push(touches, 'tag:plot', draft.plotTagIds ?? []);
  push(touches, 'image', [draft.coverImageId ?? '', ...(draft.illustrationImageIds ?? [])]);
  return touches;
}
