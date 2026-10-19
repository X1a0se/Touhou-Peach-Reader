/**
 * 随机浏览与十连抽（design §12）：纯函数、零 IO，`rng` 可注入以便测试。
 */
import type { ArticleMeta } from '@tpr/schema';
import type { DBSnapshot } from '../db/snapshot.js';

export type Rng = () => number;

export interface TenPullResult {
  /** 按抽取顺序 */
  picks: ArticleMeta[];
  /** 可用组数 < count */
  depleted: boolean;
  groupCount: number;
}

const clamp01 = (value: number): number => Math.min(0.999999, Math.max(0, value));

function pickIndex(rng: Rng, length: number): number {
  return Math.floor(clamp01(rng()) * length);
}

/** Fisher–Yates，只用注入的 rng。 */
function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = pickIndex(rng, i + 1);
    const a = items[i];
    const b = items[j];
    if (a === undefined || b === undefined) continue;
    items[i] = b;
    items[j] = a;
  }
  return items;
}

/** 从全部文章（系列内文章与独立短篇都在内）均匀抽一篇。 */
export function randomOne(snapshot: DBSnapshot, rng: Rng = Math.random): ArticleMeta | null {
  const articles = snapshot.articles;
  if (articles.length === 0) return null;
  return articles[pickIndex(rng, articles.length)] ?? null;
}

/**
 * 十连抽：同一 `seriesId` 最多出现一篇；没有 `seriesId` 的短篇各自独立成组。
 * 组数不足 count 时按实际组数返回并置 `depleted`。
 */
export function tenPull(snapshot: DBSnapshot, rng: Rng = Math.random, count = 10): TenPullResult {
  const groups = new Map<string, ArticleMeta[]>();
  for (const article of snapshot.articles) {
    const key = article.seriesId ?? `a:${article.id}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(article);
    else groups.set(key, [article]);
  }

  const keys = shuffle([...groups.keys()], rng);
  const n = Math.min(count, keys.length);
  const picks: ArticleMeta[] = [];
  for (let i = 0; i < n; i += 1) {
    const key = keys[i];
    if (key === undefined) continue;
    const pool = groups.get(key);
    if (!pool || pool.length === 0) continue;
    const pick = pool[pickIndex(rng, pool.length)];
    if (pick) picks.push(pick);
  }

  return { picks, depleted: keys.length < count, groupCount: keys.length };
}
