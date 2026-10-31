import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createDraftEnvelope,
  createDraftStore,
  newDraftId,
  stableSerialize,
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
  /** 编辑前原始 payload；与当前 payload 稳定序列化相等时删除草稿，避免空草稿 */
  baseline?: unknown;
  /** 编辑已有实体时写入 envelope.targetId */
  targetId?: string;
  /** 保存或删除草稿后通知面板刷新列表 */
  onSaved?: () => void;
  /** 当前 id 已被主动丢弃时跳过补写，防止删除草稿后被卸载/防抖重新写回 */
  isDiscarded?: (id: string) => boolean;
}

/**
 * 防抖自动保存当前表单到草稿箱。
 * 新建与编辑共用：编辑时传 baseline/targetId，只有实际改动才落盘。
 * 卸载与关窗前会把还没落盘的改动补写一次。
 */
export function useDraftAutosave(options: DraftAutosaveOptions): { error: string | null } {
  const {
    store,
    draftId,
    kind,
    label,
    payload,
    enabled = true,
    delayMs = 600,
    baseline,
    targetId,
    onSaved,
    isDiscarded,
  } = options;
  const [error, setError] = useState<string | null>(null);

  const serialized = payload === null || payload === undefined ? null : stableSerialize(payload);
  const baselineKey = baseline === undefined ? null : stableSerialize(baseline);
  const latest = useRef({
    store,
    draftId,
    kind,
    label,
    serialized,
    baseline: baselineKey,
    targetId,
    onSaved,
    isDiscarded,
  });
  latest.current = {
    store,
    draftId,
    kind,
    label,
    serialized,
    baseline: baselineKey,
    targetId,
    onSaved,
    isDiscarded,
  };

  const savedRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);

  // 换草稿时重置「已保存」标记
  useEffect(() => {
    savedRef.current = null;
  }, [draftId]);

  const flush = useCallback(() => {
    const current = latest.current;
    if (!current.store || !current.draftId || current.serialized === null) return;
    if (current.isDiscarded?.(current.draftId)) return;

    // 回到编辑前状态：删除已存在的编辑草稿，不再写入
    if (current.baseline !== null && current.serialized === current.baseline) {
      const exists =
        savedRef.current !== null || current.store.list().some((draft) => draft.id === current.draftId);
      savedRef.current = current.serialized;
      if (exists) {
        try {
          current.store.remove(current.draftId);
          setError(null);
          current.onSaved?.();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : '草稿未保存');
        }
      }
      return;
    }

    if (current.serialized === savedRef.current) return;
    try {
      current.store.save(
        createDraftEnvelope(
          current.kind,
          current.label,
          JSON.parse(current.serialized),
          current.draftId,
          current.targetId,
        ),
      );
      savedRef.current = current.serialized;
      setError(null);
      current.onSaved?.();
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
  }, [serialized, baselineKey, enabled, store, draftId, delayMs, flush]);

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

  // 关窗口前同步补写（localStorage 写入是同步的）
  useEffect(() => {
    if (!enabled || !store || !draftId) return;
    const onBeforeUnload = (): void => flush();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [enabled, store, draftId, flush]);

  return { error };
}

export interface DraftBox<T> {
  drafts: DraftEnvelope[];
  draftId: string | null;
  start(): string;
  open(id: string): DraftEnvelope<T> | null;
  /** 指向一个可能还未写入 store 的编辑草稿 id */
  activate(id: string): void;
  close(): void;
  discard(id: string): void;
  /** 该 id 是否被主动丢弃（删除草稿/删除实体后阻止补写） */
  wasDiscarded(id: string): boolean;
  refresh(): void;
}

/** 面板里通用的草稿箱状态机：新建/编辑 → 自动存 → 保存成功后丢弃 */
export function useDraftBox<T>(store: DraftStore, kind: DraftKind): DraftBox<T> {
  const { drafts, refresh, remove } = useDraftList(store, kind);
  const [draftId, setDraftId] = useState<string | null>(null);
  const discardedRef = useRef(new Set<string>());
  const wasDiscarded = useCallback((id: string) => discardedRef.current.has(id), []);

  return {
    drafts,
    draftId,
    start() {
      const id = newDraftId();
      discardedRef.current.delete(id);
      setDraftId(id);
      return id;
    },
    open(id) {
      const found = drafts.find((draft) => draft.id === id);
      if (!found) return null;
      discardedRef.current.delete(found.id);
      setDraftId(found.id);
      return found as DraftEnvelope<T>;
    },
    activate(id) {
      discardedRef.current.delete(id);
      setDraftId(id);
    },
    close() {
      setDraftId(null);
    },
    discard(id) {
      discardedRef.current.add(id);
      remove(id);
      setDraftId((current) => (current === id ? null : current));
    },
    wasDiscarded,
    refresh,
  };
}
