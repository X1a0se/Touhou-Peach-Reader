import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createDraftEnvelope,
  createDraftStore,
  newDraftId,
  type DraftEnvelope,
  type DraftKind,
  type DraftStore,
} from './drafts.js';

/** 每个面板一个 store；databaseId 变了自动换桶 */
export function useDraftStore(databaseId: string): DraftStore {
  return useMemo(() => createDraftStore(window.localStorage, databaseId), [databaseId]);
}

export interface DraftListState {
  drafts: DraftEnvelope[];
  refresh(): void;
  remove(id: string): void;
}

export function useDraftList(store: DraftStore, kind?: DraftKind): DraftListState {
  const [all, setAll] = useState<DraftEnvelope[]>([]);

  const refresh = useCallback(() => {
    setAll(store.list());
  }, [store]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const remove = useCallback(
    (id: string) => {
      store.remove(id);
      refresh();
    },
    [store, refresh],
  );

  const drafts = useMemo(
    () => (kind ? all.filter((draft) => draft.kind === kind) : all),
    [all, kind],
  );

  return { drafts, refresh, remove };
}

export interface DraftAutosaveOptions {
  store: DraftStore | null;
  draftId: string | null;
  kind: DraftKind;
  label: string;
  /** null 表示当前表单还是空的，不落草稿 */
  payload: unknown | null;
  enabled?: boolean;
  delayMs?: number;
}

/**
 * 防抖自动保存当前「新建」表单到草稿箱。
 * 卸载时会把还没落盘的改动补写一次，避免最后 600ms 丢失。
 */
export function useDraftAutosave(options: DraftAutosaveOptions): { error: string | null } {
  const { store, draftId, kind, label, payload, enabled = true, delayMs = 600 } = options;
  const [error, setError] = useState<string | null>(null);

  const serialized = payload === null || payload === undefined ? null : JSON.stringify(payload);
  const latest = useRef({ store, draftId, kind, label, serialized });
  latest.current = { store, draftId, kind, label, serialized };

  const savedRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);

  // 换草稿时重置「已保存」标记
  useEffect(() => {
    savedRef.current = null;
  }, [draftId]);

  const flush = useCallback(() => {
    const current = latest.current;
    if (!current.store || !current.draftId || current.serialized === null) return;
    if (current.serialized === savedRef.current) return;
    try {
      current.store.save(
        createDraftEnvelope(current.kind, current.label, JSON.parse(current.serialized), current.draftId),
      );
      savedRef.current = current.serialized;
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '草稿未保存');
    }
  }, []);

  useEffect(() => {
    if (!enabled || !store || !draftId || serialized === null) return;
    if (serialized === savedRef.current) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      flush();
    }, delayMs);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [serialized, enabled, store, draftId, delayMs, flush]);

  // 卸载补写
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
        flush();
      }
    };
  }, [flush]);

  return { error };
}

export interface DraftBox<T> {
  drafts: DraftEnvelope[];
  draftId: string | null;
  start(): string;
  open(id: string): DraftEnvelope<T> | null;
  close(): void;
  discard(id: string): void;
  refresh(): void;
}

/** 面板里通用的草稿箱状态机：新建 → 自动存 → 保存成功后丢弃 */
export function useDraftBox<T>(store: DraftStore, kind: DraftKind): DraftBox<T> {
  const { drafts, refresh, remove } = useDraftList(store, kind);
  const [draftId, setDraftId] = useState<string | null>(null);

  return {
    drafts,
    draftId,
    start() {
      const id = newDraftId();
      setDraftId(id);
      return id;
    },
    open(id) {
      const found = drafts.find((draft) => draft.id === id);
      if (!found) return null;
      setDraftId(found.id);
      return found as DraftEnvelope<T>;
    },
    close() {
      setDraftId(null);
    },
    discard(id) {
      remove(id);
      setDraftId((current) => (current === id ? null : current));
    },
    refresh,
  };
}
