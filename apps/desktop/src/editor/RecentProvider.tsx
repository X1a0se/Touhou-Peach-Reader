import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';
import {
  createRecentStore,
  orderByRecent,
  type RecentBucket,
  type RecentTouch,
  type RecentUsage,
} from './recent.js';

export interface RecentContextValue {
  /** 该桶里最近使用的 id，最近在前 */
  list(bucket: RecentBucket): string[];
  /** 最近使用的排到前面，其余保持 `items` 原顺序 */
  order<T extends { id: string }>(bucket: RecentBucket, items: readonly T[]): T[];
  touch(bucket: RecentBucket, ids: readonly string[]): void;
  /** 一次记多个桶（保存文章/系列后调用） */
  touchUsage(usage: readonly RecentTouch[]): void;
  /** 删除实体后把 id 从所有桶里清掉 */
  forget(ids: readonly string[]): void;
}

const RecentContext = createContext<RecentContextValue | null>(null);

/**
 * 编辑器「最近使用」排序：按库隔离（`databaseId` 变了自动换桶），
 * 写在 `localStorage`，不随数据库导出。只在保存成功时由调用方 `touch`。
 *
 * 写入后从存储重新读一份快照放进 state：localStorage 是唯一数据来源，
 * 状态只用于触发重渲染，两边不会各存一份可以分叉的记录。
 */
export function RecentProvider({
  databaseId,
  children,
}: {
  databaseId: string;
  children: ReactNode;
}) {
  const store = useMemo(() => createRecentStore(window.localStorage, databaseId), [databaseId]);
  const [usage, setUsage] = useState<RecentUsage>(() => store.snapshot());
  const [currentStore, setCurrentStore] = useState(store);

  // 换库时在渲染期同步换快照，避免先按旧库顺序画一帧
  if (currentStore !== store) {
    setCurrentStore(store);
    setUsage(store.snapshot());
  }

  const value = useMemo<RecentContextValue>(
    () => ({
      list: (bucket) => usage[bucket] ?? [],
      order: (bucket, items) => orderByRecent(items, usage[bucket] ?? []),
      touch: (bucket, ids) => {
        store.touch(bucket, ids);
        setUsage(store.snapshot());
      },
      touchUsage: (entries) => {
        for (const entry of entries) store.touch(entry.bucket, entry.ids);
        setUsage(store.snapshot());
      },
      forget: (ids) => {
        store.forget(ids);
        setUsage(store.snapshot());
      },
    }),
    [store, usage],
  );

  return <RecentContext.Provider value={value}>{children}</RecentContext.Provider>;
}

export function useRecent(): RecentContextValue {
  const value = useContext(RecentContext);
  if (!value) throw new Error('useRecent 必须在 <RecentProvider> 内使用');
  return value;
}
