/**
 * 标签屏蔽（用户态）：被屏蔽的标签默认从搜索结果中排除。
 *
 * 与收藏/阅读状态一样按数据库隔离，存在 `user/{databaseId}.blocklist.json`。
 * 只保存 id + 屏蔽时的名称；读取时如果标签还在，显示最新名称与分类。
 */
import type { Platform } from '@tpr/platform';
import type { TagCategory } from '@tpr/schema';
import type { DBSnapshot } from './db/snapshot.js';
import { userPath } from './db/workspace.js';

export interface BlockedTag {
  id: string;
  name: string;
}

export interface BlocklistState {
  version: 1;
  tags: BlockedTag[];
}

export interface BlockedTagView extends BlockedTag {
  category: TagCategory | null;
  stale: boolean;
}

export interface BlocklistService {
  readonly revision: number;
  state(): BlocklistState;
  load(): Promise<BlocklistState>;
  tags(): readonly BlockedTag[];
  list(snapshot?: DBSnapshot | null): BlockedTagView[];
  has(id: string): boolean;
  toggle(tag: { id: string; name: string }): Promise<boolean>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

export const BLOCKLIST_LIMIT = 500;

const emptyState = (): BlocklistState => ({ version: 1, tags: [] });

function normalizeState(value: unknown): BlocklistState {
  const raw =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const tags: BlockedTag[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.tags)) {
    for (const item of raw.tags) {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
      const entry = item as Record<string, unknown>;
      const id = typeof entry.id === 'string' ? entry.id.trim() : '';
      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      if (id === '' || name === '' || seen.has(id)) continue;
      seen.add(id);
      tags.push({ id, name });
      if (tags.length >= BLOCKLIST_LIMIT) break;
    }
  }
  return { version: 1, tags };
}

function blocklistFilePath(platform: Platform, databaseId: string): string {
  const file = userPath(platform, databaseId);
  return platform.paths.join(platform.paths.dirname(file), `${databaseId}.blocklist.json`);
}

export function createBlocklist(platform: Platform, databaseId: () => string | null): BlocklistService {
  let state = emptyState();
  let loadedFor: string | null = null;
  let revision = 0;

  const path = (): string | null => {
    // 同 reading：已载入的状态只写回它自己的库文件，避免切库瞬间串库。
    return loadedFor === null ? null : blocklistFilePath(platform, loadedFor);
  };

  async function persist(): Promise<void> {
    const file = path();
    if (!file) return;
    await platform.fs.mkdir(platform.paths.dirname(file));
    const tmp = `${file}.tmp`;
    await platform.fs.writeText(tmp, `${JSON.stringify(state, null, 2)}\n`);
    await platform.fs.rename(tmp, file);
    revision += 1;
  }

  async function ensureLoaded(): Promise<void> {
    const id = databaseId();
    if (!id) {
      if (loadedFor !== null) {
        state = emptyState();
        loadedFor = null;
      }
      return;
    }
    if (loadedFor === id) return;
    loadedFor = id;
    const file = blocklistFilePath(platform, id);
    if (!(await platform.fs.exists(file))) {
      state = emptyState();
      return;
    }
    try {
      state = normalizeState(JSON.parse(await platform.fs.readText(file)));
    } catch {
      state = emptyState();
    }
  }

  return {
    get revision() {
      return revision;
    },

    state: () => state,

    async load() {
      await ensureLoaded();
      revision += 1;
      return state;
    },

    tags: () => state.tags.map((tag) => ({ ...tag })),

    list(snapshot) {
      return state.tags.map((entry) => {
        const tag = snapshot?.maps.tags.get(entry.id);
        return {
          id: entry.id,
          name: tag?.name ?? entry.name,
          category: tag?.category ?? null,
          stale: !tag,
        };
      });
    },

    has(id) {
      return state.tags.some((tag) => tag.id === id);
    },

    async toggle(tag) {
      await ensureLoaded();
      const id = tag.id.trim();
      const name = tag.name.trim();
      if (id === '' || name === '') return false;
      if (state.tags.some((item) => item.id === id)) {
        state.tags = state.tags.filter((item) => item.id !== id);
        await persist();
        return false;
      }
      state.tags = [{ id, name }, ...state.tags].slice(0, BLOCKLIST_LIMIT);
      await persist();
      return true;
    },

    async remove(id) {
      await ensureLoaded();
      state.tags = state.tags.filter((tag) => tag.id !== id);
      await persist();
    },

    async clear() {
      await ensureLoaded();
      state.tags = [];
      await persist();
    },
  };
}
