import type {
  ArticleReading,
  ReadingBookmarkItem,
  ReadingHistoryItem,
  ReadingVisit,
  SeriesReading,
} from '@tpr/core';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useServices } from '../context.js';
import { useLibraryContext } from '../library/LibraryProvider.js';

interface ReadingContextValue {
  ready: boolean;
  bookmarks: ReadingBookmarkItem[];
  history: ReadingHistoryItem[];
  article(id: string): ArticleReading | null;
  series(id: string): SeriesReading | null;
  visit(input: ReadingVisit): void;
  recordProgress(id: string, progress: number, scrollY: number): void;
  toggleBookmark(id: string, progress: number, scrollY: number): Promise<boolean>;
  removeHistory(id: string): Promise<void>;
  clearHistory(): Promise<void>;
  flush(): Promise<void>;
  refresh(): void;
}

const ReadingContext = createContext<ReadingContextValue | null>(null);

export function ReadingProvider({ children }: { children: ReactNode }) {
  const services = useServices();
  const { snapshot } = useLibraryContext();
  const databaseId = snapshot?.manifest.databaseId ?? null;
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    void services.reading
      .load()
      .then(() => {
        if (cancelled) return;
        setReady(true);
        refresh();
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        console.warn(
          `[reading] 读取阅读状态失败：${cause instanceof Error ? cause.message : String(cause)}`,
        );
        setReady(true);
        refresh();
      });
    return () => {
      cancelled = true;
    };
  }, [services, databaseId, refresh]);

  // 切换数据库/离开应用时把防抖中的进度落盘
  useEffect(() => {
    return () => {
      void services.reading.flush();
    };
  }, [services, databaseId]);

  const visit = useCallback(
    (input: ReadingVisit): void => {
      services.reading.visit(input);
      refresh();
    },
    [services, refresh],
  );

  const recordProgress = useCallback(
    (id: string, progress: number, scrollY: number): void => {
      // 滚动很频繁：只写内存并排定落盘，不触发 Provider 重渲染
      services.reading.recordProgress(id, progress, scrollY);
    },
    [services],
  );

  const toggleBookmark = useCallback(
    async (id: string, progress: number, scrollY: number): Promise<boolean> => {
      const next = await services.reading.toggleBookmark(id, progress, scrollY);
      refresh();
      return next;
    },
    [services, refresh],
  );

  const removeHistory = useCallback(
    async (id: string): Promise<void> => {
      await services.reading.removeHistory(id);
      refresh();
    },
    [services, refresh],
  );

  const clearHistory = useCallback(async (): Promise<void> => {
    await services.reading.clearHistory();
    refresh();
  }, [services, refresh]);

  const flush = useCallback(async (): Promise<void> => {
    await services.reading.flush();
  }, [services]);

  const bookmarks = useMemo(
    () => services.reading.bookmarks(snapshot),
    // version 用于在书签/历史变化后重算
    [services, snapshot, version],
  );
  const history = useMemo(
    () => services.reading.history(snapshot),
    [services, snapshot, version],
  );

  const value: ReadingContextValue = {
    ready,
    bookmarks,
    history,
    article: (id) => services.reading.article(id),
    series: (id) => services.reading.series(id),
    visit,
    recordProgress,
    toggleBookmark,
    removeHistory,
    clearHistory,
    flush,
    refresh,
  };

  return <ReadingContext.Provider value={value}>{children}</ReadingContext.Provider>;
}

export function useReading(): ReadingContextValue {
  const value = useContext(ReadingContext);
  if (!value) throw new Error('useReading 必须在 <ReadingProvider> 内使用');
  return value;
}
