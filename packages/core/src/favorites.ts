/**
 * 收藏夹（Goal 7）：落在用户态文件 `user/{databaseId}.json`，不进数据库包、不参与导出。
 * 目标消失时**保留 id 并标记 stale**，由 UI 显示"已失效"（design §9.1）。
 */
import type { Platform } from '@tpr/platform';
import type { DBSnapshot } from './db/snapshot.js';
import { hasR18PlotTag, resolveTags, type TagRef } from './db/view.js';
import { userPath } from './db/workspace.js';

export type FavoriteKind = 'article' | 'series';

export interface FavoritesState {
  articles: string[];
  series: string[];
}

export interface FavoriteEntry {
  kind: FavoriteKind;
  id: string;
  title: string;
  summary: string;
  /** 角色 + 情节标签；失效条目为空数组 */
  tags: TagRef[];
  /** 情节标签里是否含 R18；失效条目为 false */
  r18: boolean;
  /** 失效条目没有可跳转路由 */
  to: string | null;
  stale: boolean;
}

export interface Favorites {
  /** 每次从磁盘载入或写入都 +1，React 侧据此重渲染。 */
  readonly revision: number;
  state(): FavoritesState;
  /** 从磁盘读当前库的收藏；没有文件时得到空状态。 */
  load(): Promise<FavoritesState>;
  isFavorite(kind: FavoriteKind, id: string): boolean;
  /** 返回操作后的状态：true=已收藏，false=已取消。 */
  toggle(kind: FavoriteKind, id: string): Promise<boolean>;
  remove(kind: FavoriteKind, id: string): Promise<void>;
  /** 把 id 解析成可渲染条目；目标已不存在时 stale=true。 */
  list(snapshot: DBSnapshot | null): { articles: FavoriteEntry[]; series: FavoriteEntry[] };
}

const EMPTY: FavoritesState = { articles: [], series: [] };

function normalizeState(value: unknown): FavoritesState {
  const favorites = (value as { favorites?: unknown } | null)?.favorites as Partial<FavoritesState> | null | undefined;
  const pick = (input: unknown): string[] =>
    Array.isArray(input) ? [...new Set(input.filter((item): item is string => typeof item === 'string'))] : [];
  return { articles: pick(favorites?.articles), series: pick(favorites?.series) };
}

export function createFavorites(platform: Platform, databaseId: () => string | null): Favorites {
  let state: FavoritesState = { articles: [], series: [] };
  let loadedFor: string | null = null;
  let revision = 0;

  const path = (): string | null => {
    const id = databaseId();
    return id ? userPath(platform, id) : null;
  };

  async function persist(): Promise<void> {
    const file = path();
    if (!file) return;
    await platform.fs.mkdir(platform.paths.dirname(file));
    const tmp = `${file}.tmp`;
    const payload = { favorites: state };
    await platform.fs.writeText(tmp, `${JSON.stringify(payload, null, 2)}\n`);
    await platform.fs.rename(tmp, file);
    revision += 1;
  }

  async function ensureLoaded(): Promise<void> {
    const id = databaseId();
    if (!id || loadedFor === id) return;
    loadedFor = id;
    const file = userPath(platform, id);
    if (!(await platform.fs.exists(file))) {
      state = { articles: [], series: [] };
      return;
    }
    try {
      state = normalizeState(JSON.parse(await platform.fs.readText(file)));
    } catch {
      state = { articles: [], series: [] };
    }
  }

  const listOf = (kind: FavoriteKind): string[] => (kind === 'article' ? state.articles : state.series);

  return {
    get revision() {
      return revision;
    },

    state: () => ({ articles: [...state.articles], series: [...state.series] }),

    async load() {
      await ensureLoaded();
      revision += 1;
      return { articles: [...state.articles], series: [...state.series] };
    },

    isFavorite(kind, id) {
      return listOf(kind).includes(id);
    },

    async toggle(kind, id) {
      await ensureLoaded();
      const key = kind === 'article' ? 'articles' : 'series';
      const current = state[key];
      if (current.includes(id)) {
        state[key] = current.filter((item) => item !== id);
        await persist();
        return false;
      }
      // 新加入的放最前（最近收藏在最上）
      state[key] = [id, ...current];
      await persist();
      return true;
    },

    async remove(kind, id) {
      await ensureLoaded();
      const key = kind === 'article' ? 'articles' : 'series';
      state[key] = state[key].filter((item) => item !== id);
      await persist();
    },

    list(snapshot) {
      const toEntry = (kind: FavoriteKind, id: string): FavoriteEntry => {
        if (kind === 'article') {
          const article = snapshot?.maps.articles.get(id);
          return {
            kind,
            id,
            title: article?.title ?? id,
            summary: article?.summary ?? '',
            tags: article && snapshot ? resolveTags(snapshot, [...article.characterTagIds, ...article.plotTagIds]) : [],
            r18: article && snapshot ? hasR18PlotTag(snapshot, article.plotTagIds) : false,
            to: article ? `/article/${id}` : null,
            stale: !article,
          };
        }
        const series = snapshot?.maps.series.get(id);
        return {
          kind,
          id,
          title: series?.title ?? id,
          summary: series?.summary ?? '',
          tags: series && snapshot ? resolveTags(snapshot, [...series.characterTagIds, ...series.plotTagIds]) : [],
          r18: series && snapshot ? hasR18PlotTag(snapshot, series.plotTagIds) : false,
          to: series ? `/series/${id}` : null,
          stale: !series,
        };
      };
      return {
        articles: state.articles.map((id) => toEntry('article', id)),
        series: state.series.map((id) => toEntry('series', id)),
      };
    },
  };
}
