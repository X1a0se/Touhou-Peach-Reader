/**
 * 编辑器草稿箱（Goal 16）。
 *
 * 只保存在本机 `localStorage`，按 `databaseId` 隔离，不随数据库导出。
 * 纯逻辑 + 注入 storage，便于在 node 环境单测。
 */

export type DraftKind = 'article' | 'series' | 'author' | 'tag' | 'image' | 'featured' | 'credits';

export interface DraftEnvelope<T = unknown> {
  v: 1;
  id: string;
  kind: DraftKind;
  /** 列表里显示的名字；调用方给不出好名字时用「未命名…」 */
  label: string;
  updatedAt: string;
  payload: T;
  /** 编辑已有实体时的目标 id；新建草稿没有这个字段 */
  targetId?: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type DraftErrorCode = 'E_QUOTA' | 'E_TOO_LARGE' | 'E_PARSE';

export class DraftStorageError extends Error {
  readonly code: DraftErrorCode;

  constructor(code: DraftErrorCode, message: string) {
    super(message);
    this.name = 'DraftStorageError';
    this.code = code;
  }
}

export const DRAFT_KEY_PREFIX = 'tpr:drafts:v1:';
/** 每个库最多保留的草稿数，超出时删最旧的 */
export const MAX_DRAFTS = 50;
/** 单条草稿 payload 的字符上限（localStorage 通常 5MB，留出余量） */
export const MAX_PAYLOAD_CHARS = 1_500_000;

export function draftKey(databaseId: string): string {
  return `${DRAFT_KEY_PREFIX}${databaseId || '_none'}`;
}

export interface DraftStore {
  readonly databaseId: string;
  list(): DraftEnvelope[];
  save(draft: DraftEnvelope): void;
  remove(id: string): void;
  clear(): void;
}

export function newDraftId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createDraftEnvelope<T>(
  kind: DraftKind,
  label: string,
  payload: T,
  id: string = newDraftId(),
  targetId?: string,
): DraftEnvelope<T> {
  return {
    v: 1,
    id,
    kind,
    label,
    updatedAt: new Date().toISOString(),
    payload,
    ...(targetId === undefined ? {} : { targetId }),
  };
}

/** 编辑已有实体时的稳定草稿 id：同一实体永远对应同一条草稿。 */
export function editDraftId(kind: DraftKind, targetId: string): string {
  return `edit:${kind}:${targetId}`;
}

export function isEditDraft(draft: DraftEnvelope): boolean {
  return typeof draft.targetId === 'string' && draft.targetId.length > 0;
}

export function findDraftForTarget(
  drafts: readonly DraftEnvelope[],
  kind: DraftKind,
  targetId: string,
): DraftEnvelope | undefined {
  return drafts.find((draft) => draft.kind === kind && draft.targetId === targetId);
}

/** 递归按 key 排序后序列化，用于忽略对象 key 顺序的 payload 比较。 */
export function stableSerialize(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input !== null && typeof input === 'object') {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(input as Record<string, unknown>).sort()) {
        out[key] = normalize((input as Record<string, unknown>)[key]);
      }
      return out;
    }
    return input;
  };
  return JSON.stringify(normalize(value)) ?? 'null';
}

const KINDS: readonly DraftKind[] = [
  'article',
  'series',
  'author',
  'tag',
  'image',
  'featured',
  'credits',
];

function isDraft(value: unknown): value is DraftEnvelope {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<DraftEnvelope>;
  return (
    draft.v === 1 &&
    typeof draft.id === 'string' &&
    typeof draft.label === 'string' &&
    typeof draft.updatedAt === 'string' &&
    KINDS.includes(draft.kind as DraftKind) &&
    'payload' in draft &&
    (draft.targetId === undefined || typeof draft.targetId === 'string')
  );
}

export function createDraftStore(storage: StorageLike, databaseId: string): DraftStore {
  const key = draftKey(databaseId);

  const read = (): DraftEnvelope[] => {
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch {
      return [];
    }
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isDraft).map((draft) => ({ ...draft, payload: draft.payload }));
    } catch {
      return [];
    }
  };

  const write = (drafts: DraftEnvelope[]): void => {
    const sorted = [...drafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const pruned = sorted.slice(0, MAX_DRAFTS);
    const text = JSON.stringify(pruned);
    try {
      storage.setItem(key, text);
    } catch (cause) {
      const quota = cause instanceof Error && /quota/i.test(cause.name + cause.message);
      throw new DraftStorageError(
        quota ? 'E_QUOTA' : 'E_TOO_LARGE',
        quota ? '本地存储空间不足，草稿未保存' : '草稿太大，未能保存',
      );
    }
  };

  return {
    databaseId,
    list() {
      return read().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    save(draft) {
      const payloadSize = JSON.stringify(draft.payload ?? null).length;
      if (payloadSize > MAX_PAYLOAD_CHARS) {
        throw new DraftStorageError('E_TOO_LARGE', '草稿内容过大，未能保存');
      }
      const next = read().filter((item) => item.id !== draft.id);
      next.push(draft);
      write(next);
    },
    remove(id) {
      write(read().filter((item) => item.id !== id));
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
