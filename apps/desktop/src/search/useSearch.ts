import type { FilterKind, SearchItem, Services } from '@tpr/core';
import { useCallback, useEffect, useRef, useState } from 'react';

export type SearchStatus = 'idle' | 'indexing' | 'running' | 'done' | 'error';

export interface SearchState {
  status: SearchStatus;
  items: SearchItem[];
  total: number;
  tookMs: number;
  indexSize: number;
  error: string | null;
}

const EMPTY: SearchState = {
  status: 'idle',
  items: [],
  total: 0,
  tookMs: 0,
  indexSize: 0,
  error: null,
};

export interface SearchController extends SearchState {
  query: string;
  filter: FilterKind;
  setQuery(value: string): void;
  setFilter(value: FilterKind): void;
}

const DEBOUNCE_MS = 200;

/**
 * 搜索页状态（design §11.7）：200 ms 防抖 + 序号，过期响应直接丢弃。
 * `enabled=false`（库还没载入）时不做任何事。
 */
export function useSearch(services: Services, enabled: boolean): SearchController {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKind>('all');
  const [state, setState] = useState<SearchState>(EMPTY);
  const seq = useRef(0);

  // 索引只在库可用时建一次；之后 revision 变化由 core 内部判断
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState((prev) => ({ ...prev, status: 'indexing' }));
    void services.search
      .ready()
      .then(() => {
        if (!cancelled) setState((prev) => ({ ...prev, status: 'idle' }));
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: cause instanceof Error ? cause.message : String(cause),
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, services]);

  useEffect(() => {
    if (!enabled) return;
    const trimmed = query.trim();
    const current = seq.current + 1;
    seq.current = current;

    if (trimmed.length === 0) {
      setState(EMPTY);
      return;
    }

    const timer = setTimeout(() => {
      setState((prev) => ({ ...prev, status: 'running' }));
      void services.search
        .search(trimmed, { filter })
        .then((result) => {
          if (seq.current !== current) return;
          setState({
            status: 'done',
            items: result.items,
            total: result.total,
            tookMs: result.tookMs,
            indexSize: result.indexSize,
            error: null,
          });
        })
        .catch((cause: unknown) => {
          if (seq.current !== current) return;
          setState((prev) => ({
            ...prev,
            status: 'error',
            error: cause instanceof Error ? cause.message : String(cause),
          }));
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, filter, enabled, services]);

  const changeQuery = useCallback((value: string) => setQuery(value), []);
  const changeFilter = useCallback((value: FilterKind) => setFilter(value), []);

  return {
    ...state,
    query,
    filter,
    setQuery: changeQuery,
    setFilter: changeFilter,
  };
}
