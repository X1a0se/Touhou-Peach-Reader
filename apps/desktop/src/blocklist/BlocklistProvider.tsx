import type { BlockedTagView } from '@tpr/core';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useServices } from '../context.js';
import { useLibraryContext } from '../library/LibraryProvider.js';

interface BlocklistContextValue {
  ready: boolean;
  tags: BlockedTagView[];
  ids: string[];
  names: string[];
  has(id: string): boolean;
  toggle(tag: { id: string; name: string }): Promise<boolean>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

const BlocklistContext = createContext<BlocklistContextValue | null>(null);

export function BlocklistProvider({ children }: { children: ReactNode }) {
  const services = useServices();
  const { snapshot } = useLibraryContext();
  const databaseId = snapshot?.manifest.databaseId ?? null;
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    void services.blocklist
      .load()
      .then(() => {
        if (cancelled) return;
        setReady(true);
        refresh();
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        console.warn(
          `[blocklist] 读取屏蔽列表失败：${cause instanceof Error ? cause.message : String(cause)}`,
        );
        setReady(true);
        refresh();
      });
    return () => {
      cancelled = true;
    };
  }, [services, databaseId, refresh]);

  const toggle = useCallback(
    async (tag: { id: string; name: string }): Promise<boolean> => {
      const next = await services.blocklist.toggle(tag);
      refresh();
      return next;
    },
    [services, refresh],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      await services.blocklist.remove(id);
      refresh();
    },
    [services, refresh],
  );

  const clear = useCallback(async (): Promise<void> => {
    await services.blocklist.clear();
    refresh();
  }, [services, refresh]);

  const tags = useMemo(
    () => services.blocklist.list(snapshot),
    // version 用于在屏蔽名单变化后重算
    [services, snapshot, version],
  );

  const value: BlocklistContextValue = {
    ready,
    tags,
    ids: tags.map((tag) => tag.id),
    names: tags.map((tag) => tag.name),
    has: (id) => tags.some((tag) => tag.id === id),
    toggle,
    remove,
    clear,
  };

  return <BlocklistContext.Provider value={value}>{children}</BlocklistContext.Provider>;
}

export function useBlocklist(): BlocklistContextValue {
  const value = useContext(BlocklistContext);
  if (!value) throw new Error('useBlocklist 必须在 <BlocklistProvider> 内使用');
  return value;
}
