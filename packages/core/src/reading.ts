/**
 * 阅读状态（上次阅读位置 / 系列进度 / 足迹）。
 *
 * 与收藏一样属于用户态数据：落在 `user/{databaseId}.reading.json`，不进数据库包、
 * 不参与导出。进度更新频繁，写盘使用约 800ms 防抖。
 */
import type { Platform } from '@tpr/platform';
import type { DBSnapshot } from './db/snapshot.js';
import { articleSeriesPosition, hasR18PlotTag, resolveTags, type TagRef } from './db/view.js';
import { userPath } from './db/workspace.js';

export interface ArticleReading {
  articleId: string;
  seriesId: string | null;
  progress: number;
  scrollY: number;
  lastReadAt: string;
}

export interface SeriesReading {
  seriesId: string;
  articleId: string;
  /** 1 基；仅用于快速显示，文章移动后以 snapshot 的实际位置为准 */
  index: number | null;
  lastReadAt: string;
}

export interface ReadingHistoryEntry {
  articleId: string;
  seriesId: string | null;
  progress: number;
  scrollY: number;
  lastReadAt: string;
}

export interface ReadingState {
  version: 2;
  articles: Record<string, ArticleReading>;
  series: Record<string, SeriesReading>;
  history: ReadingHistoryEntry[];
}

export interface ReadingVisit {
  articleId: string;
  seriesId?: string | null;
  seriesIndex?: number | null;
}

export interface ReadingHistoryItem {
  articleId: string;
  title: string;
  summary: string;
  series: { id: string; title: string; index: number | null } | null;
  lastReadAt: string;
  progress: number;
  tags: TagRef[];
  r18: boolean;
  to: string | null;
}

export interface ReadingService {
  readonly revision: number;
  state(): ReadingState;
  load(): Promise<ReadingState>;
  article(id: string): ArticleReading | null;
  series(id: string): SeriesReading | null;
  history(snapshot?: DBSnapshot | null): ReadingHistoryItem[];
  visit(input: ReadingVisit): void;
  recordProgress(id: string, progress: number, scrollY: number): void;
  removeHistory(id: string): Promise<void>;
  clearHistory(): Promise<void>;
  flush(): Promise<void>;
}

export const HISTORY_LIMIT = 500;
const SAVE_DELAY_MS = 800;

const nowIso = (): string => new Date().toISOString();

const clampProgress = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
};

const clampScrollY = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return value;
};

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const emptyState = (): ReadingState => ({ version: 2, articles: {}, series: {}, history: [] });

function normalizeArticle(value: unknown, articleId: string): ArticleReading | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const seriesId = typeof raw.seriesId === 'string' && raw.seriesId !== '' ? raw.seriesId : null;
  return {
    articleId,
    seriesId,
    progress: clampProgress(raw.progress),
    scrollY: clampScrollY(raw.scrollY),
    lastReadAt: asString(raw.lastReadAt),
  };
}

function normalizeSeries(value: unknown, seriesId: string): SeriesReading | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const articleId = asString(raw.articleId);
  if (articleId === '') return null;
  const index =
    typeof raw.index === 'number' && Number.isFinite(raw.index) && raw.index >= 1
      ? Math.floor(raw.index)
      : null;
  return {
    seriesId,
    articleId,
    index,
    lastReadAt: asString(raw.lastReadAt),
  };
}

function normalizeHistoryEntry(value: unknown): ReadingHistoryEntry | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const articleId = asString(raw.articleId);
  if (articleId === '') return null;
  return {
    articleId,
    seriesId: typeof raw.seriesId === 'string' && raw.seriesId !== '' ? raw.seriesId : null,
    progress: clampProgress(raw.progress),
    scrollY: clampScrollY(raw.scrollY),
    lastReadAt: asString(raw.lastReadAt),
  };
}

/** 宽容解析：损坏条目丢弃，不因为一个坏字段把整份阅读状态清空。 */
export function normalizeReadingState(value: unknown): ReadingState {
  const raw =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const articles: Record<string, ArticleReading> = {};
  if (raw.articles !== null && typeof raw.articles === 'object' && !Array.isArray(raw.articles)) {
    for (const [id, item] of Object.entries(raw.articles as Record<string, unknown>)) {
      const normalized = normalizeArticle(item, id);
      if (normalized) articles[id] = normalized;
    }
  }
  const series: Record<string, SeriesReading> = {};
  if (raw.series !== null && typeof raw.series === 'object' && !Array.isArray(raw.series)) {
    for (const [id, item] of Object.entries(raw.series as Record<string, unknown>)) {
      const normalized = normalizeSeries(item, id);
      if (normalized) series[id] = normalized;
    }
  }
  const history: ReadingHistoryEntry[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.history)) {
    for (const item of raw.history) {
      const normalized = normalizeHistoryEntry(item);
      if (!normalized || seen.has(normalized.articleId)) continue;
      seen.add(normalized.articleId);
      history.push(normalized);
      if (history.length >= HISTORY_LIMIT) break;
    }
  }
  return { version: 2, articles, series, history };
}

function readingFilePath(platform: Platform, databaseId: string): string {
  const file = userPath(platform, databaseId);
  return platform.paths.join(platform.paths.dirname(file), `${databaseId}.reading.json`);
}

export function createReading(platform: Platform, databaseId: () => string | null): ReadingService {
  let state = emptyState();
  let loadedFor: string | null = null;
  let revision = 0;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const path = (): string | null => {
    // 写盘永远写给「当前已载入的那个库」，而不是 databaseId() 的最新值：
    // 切库瞬间 databaseId 已经变了，旧状态不能写进新库的文件。
    return loadedFor === null ? null : readingFilePath(platform, loadedFor);
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

  async function persistQuietly(): Promise<void> {
    try {
      await persist();
    } catch (cause) {
      console.warn(`[reading] 保存阅读状态失败：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  function schedulePersist(): void {
    if (saveTimer !== null) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void persistQuietly();
    }, SAVE_DELAY_MS);
  }

  async function ensureLoaded(): Promise<void> {
    const id = databaseId();
    if (!id) {
      if (loadedFor !== null) {
        await persistQuietly();
        state = emptyState();
        loadedFor = null;
      }
      return;
    }
    if (loadedFor === id) return;
    if (loadedFor !== null) {
      // 先把上一个库的进度写回它自己的文件，再切换到新库。
      await persistQuietly();
    }
    loadedFor = id;
    const file = readingFilePath(platform, id);
    if (!(await platform.fs.exists(file))) {
      state = emptyState();
      return;
    }
    try {
      state = normalizeReadingState(JSON.parse(await platform.fs.readText(file)));
    } catch {
      state = emptyState();
    }
  }

  function ensureArticle(articleId: string): ArticleReading {
    const current = state.articles[articleId];
    if (current) return current;
    const created: ArticleReading = {
      articleId,
      seriesId: null,
      progress: 0,
      scrollY: 0,
      lastReadAt: nowIso(),
    };
    state.articles[articleId] = created;
    return created;
  }

  function historyItem(
    entry: { articleId: string; progress: number; lastReadAt: string },
    snapshot: DBSnapshot | null | undefined,
  ): ReadingHistoryItem {
    const article = snapshot?.maps.articles.get(entry.articleId);
    const position = snapshot ? articleSeriesPosition(snapshot, entry.articleId) : null;
    return {
      articleId: entry.articleId,
      title: article?.title ?? entry.articleId,
      summary: article?.summary ?? '',
      series: position
        ? { id: position.series.id, title: position.series.title, index: position.index }
        : null,
      lastReadAt: entry.lastReadAt,
      progress: entry.progress,
      tags:
        article && snapshot
          ? resolveTags(snapshot, [...article.characterTagIds, ...article.plotTagIds])
          : [],
      r18: article && snapshot ? hasR18PlotTag(snapshot, article.plotTagIds) : false,
      to: article ? `/article/${entry.articleId}` : null,
    };
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

    article(id) {
      return state.articles[id] ?? null;
    },

    series(id) {
      return state.series[id] ?? null;
    },

    history(snapshot) {
      return state.history.map((entry) => historyItem(entry, snapshot));
    },

    visit(input) {
      const stamp = nowIso();
      const article = ensureArticle(input.articleId);
      article.seriesId = input.seriesId ?? article.seriesId;
      article.lastReadAt = stamp;

      if (input.seriesId) {
        state.series[input.seriesId] = {
          seriesId: input.seriesId,
          articleId: input.articleId,
          index: input.seriesIndex ?? null,
          lastReadAt: stamp,
        };
      }

      const historyEntry: ReadingHistoryEntry = {
        articleId: input.articleId,
        seriesId: article.seriesId,
        progress: article.progress,
        scrollY: article.scrollY,
        lastReadAt: stamp,
      };
      state.history = [historyEntry, ...state.history.filter((item) => item.articleId !== input.articleId)].slice(
        0,
        HISTORY_LIMIT,
      );
      schedulePersist();
    },

    recordProgress(id, progress, scrollY) {
      const article = ensureArticle(id);
      article.progress = clampProgress(progress);
      article.scrollY = clampScrollY(scrollY);
      article.lastReadAt = nowIso();
      const entry = state.history.find((item) => item.articleId === id);
      if (entry) {
        entry.progress = article.progress;
        entry.scrollY = article.scrollY;
        entry.lastReadAt = article.lastReadAt;
      }
      schedulePersist();
    },

    async removeHistory(id) {
      await ensureLoaded();
      state.history = state.history.filter((entry) => entry.articleId !== id);
      await persist();
    },

    async clearHistory() {
      await ensureLoaded();
      state.history = [];
      await persist();
    },

    async flush() {
      if (saveTimer !== null) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      await persist();
    },
  };
}
