/**
 * 搜索引擎适配层（design §11.4）。
 *
 * 只有这个文件 import `flexsearch`；换成别的引擎只需重写 `createSearchEngine`。
 * 索引字段先用自己的分词器切好，FlexSearch 只负责召回。
 */
import type { TagCategory } from '@tpr/schema';
import { Index } from 'flexsearch';
import { isEmptyQuery, normalizeTagName, parseQuery } from './parse-query.js';
import { bigramsOnly, isCjk, tokenizeZh } from './tokenize.js';

export type HitKind = 'article' | 'series' | 'author' | 'tag';

export type FilterKind = 'all' | 'short' | 'series' | 'author' | 'tag-character' | 'tag-plot';

export const FIELD_NAMES = ['title', 'summary', 'body', 'people', 'tags'] as const;
export type FieldName = (typeof FIELD_NAMES)[number];

/** 字段权重：标题最高，正文最低（design §11.5） */
export const FIELD_WEIGHTS: Record<FieldName, number> = {
  title: 3,
  people: 2.2,
  tags: 2,
  summary: 1.2,
  body: 1,
};

export interface SearchFieldTokens {
  title?: readonly string[];
  summary?: readonly string[];
  body?: readonly string[];
  people?: readonly string[];
  tags?: readonly string[];
}

export interface SearchDoc {
  rid: string;
  kind: HitKind;
  id: string;
  updatedAt: string;
  /** 虚拟标签：`v:short` / `v:series-entry` / `v:completed` / `v:ongoing` */
  virtual: string[];
  /** 关联的角色/情节/主题标签归一化名，供 `#标签名` 精确检索 */
  tagNames: string[];
  category?: TagCategory;
  tokens: SearchFieldTokens;
}

export interface SearchHit {
  kind: HitKind;
  id: string;
  score: number;
  matchedFields: string[];
}

export interface SearchOptions {
  filter?: FilterKind;
  limit?: number;
}

export interface SearchEngine {
  add(docs: readonly SearchDoc[]): void;
  remove(rids: readonly string[]): void;
  search(query: string, opts?: SearchOptions): SearchHit[];
  readonly size: number;
  dispose(): void;
}

const MAX_TOKENS = 64;
const MAX_TOKEN_LENGTH = 64;
const DEFAULT_LIMIT = 50;

interface FlexIndex {
  add(id: string, content: string): unknown;
  remove(id: string): unknown;
  search(query: string, options?: { limit?: number }): unknown;
}

function createFieldIndex(): FlexIndex {
  return new Index({ tokenize: 'strict', resolution: 9 }) as unknown as FlexIndex;
}

function toIds(result: unknown): string[] {
  if (!Array.isArray(result)) return [];
  const ids: string[] = [];
  for (const item of result) {
    if (typeof item === 'string' || typeof item === 'number') ids.push(String(item));
  }
  return ids;
}

function sanitizeTokens(tokens: readonly string[]): string[] {
  const out = tokens
    .filter((token) => token.length > 0 && token.length <= MAX_TOKEN_LENGTH)
    .slice(0, MAX_TOKENS);
  return [...new Set(out)];
}

export function createSearchEngine(): SearchEngine {
  const docs = new Map<string, SearchDoc>();
  const indexes = new Map<FieldName, FlexIndex>();
  for (const field of FIELD_NAMES) indexes.set(field, createFieldIndex());

  const matchesFilter = (doc: SearchDoc, filter: FilterKind): boolean => {
    switch (filter) {
      case 'all':
        return true;
      case 'short':
        return doc.kind === 'article' && doc.virtual.includes('v:short');
      case 'series':
        return doc.kind === 'series';
      case 'author':
        return doc.kind === 'author';
      case 'tag-character':
        return doc.kind === 'tag' && doc.category === 'character';
      case 'tag-plot':
        return doc.kind === 'tag' && doc.category === 'plot';
      default:
        return true;
    }
  };

  const add = (incoming: readonly SearchDoc[]) => {
    for (const doc of incoming) {
      docs.set(doc.rid, doc);
      for (const field of FIELD_NAMES) {
        const tokens = doc.tokens[field];
        if (!tokens || tokens.length === 0) continue;
        const index = indexes.get(field);
        index?.add(doc.rid, sanitizeTokens(tokens).join(' '));
      }
    }
  };

  const remove = (rids: readonly string[]) => {
    for (const rid of rids) {
      if (!docs.has(rid)) continue;
      docs.delete(rid);
      for (const field of FIELD_NAMES) {
        const index = indexes.get(field);
        index?.remove(rid);
      }
    }
  };

  const run = (
    tokens: readonly string[],
    parsed: ReturnType<typeof parseQuery>,
    opts: SearchOptions,
  ): SearchHit[] => {
    const filter = opts.filter ?? 'all';
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const scoreByRid = new Map<string, number>();
    const fieldsByRid = new Map<string, Set<string>>();

    for (const field of FIELD_NAMES) {
      const index = indexes.get(field);
      if (!index) continue;
      for (const token of tokens) {
        for (const rid of toIds(index.search(token, { limit: docs.size || 1 }))) {
          const doc = docs.get(rid);
          if (!doc) continue;
          if (!matchesFilter(doc, filter)) continue;
          scoreByRid.set(rid, (scoreByRid.get(rid) ?? 0) + FIELD_WEIGHTS[field]);
          const fields = fieldsByRid.get(rid) ?? new Set<string>();
          fields.add(field);
          fieldsByRid.set(rid, fields);
        }
      }
    }

    const requireVirtual = parsed.virtualTags;
    const requireTags = parsed.tagNames.map(normalizeTagName);

    const candidates: SearchHit[] = [];
    const consider = (doc: SearchDoc, score: number) => {
      if (!matchesFilter(doc, filter)) return;
      if (!requireVirtual.every((tag) => doc.virtual.includes(tag))) return;
      if (requireTags.length > 0 && !requireTags.every((name) => doc.tagNames.includes(name))) return;
      candidates.push({
        kind: doc.kind,
        id: doc.id,
        score,
        matchedFields: [...(fieldsByRid.get(doc.rid) ?? [])],
      });
    };

    if (tokens.length === 0) {
      for (const doc of docs.values()) consider(doc, 0);
    } else {
      for (const [rid, score] of scoreByRid) {
        const doc = docs.get(rid);
        if (doc) consider(doc, score);
      }
    }

    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aDoc = docs.get(ridOf(a));
      const bDoc = docs.get(ridOf(b));
      const byTime = (bDoc?.updatedAt ?? '').localeCompare(aDoc?.updatedAt ?? '');
      return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
    });

    return candidates.slice(0, limit);
  };

  const search = (query: string, opts: SearchOptions = {}): SearchHit[] => {
    const parsed = parseQuery(query);
    if (isEmptyQuery(parsed)) return [];

    // 索引里的 CJK 串存的是「整串 + 二元组」，查询串里的长 CJK 词必须同样拆成二元组，
    // 否则「魔理沙」这个 3 字词在索引中不存在，会漏召回。
    const queryTokens = [
      ...parsed.phrases.map((phrase) => phrase.normalize('NFKC').toLowerCase()),
      ...tokenizeZh(parsed.terms.join(' ')),
    ].flatMap((token) => (isCjk(token) && token.length > 2 ? bigramsOf(token) : [token]));
    const baseTokens = sanitizeTokens(queryTokens);

    const first = run(baseTokens, parsed, opts);
    if (first.length > 0 || parsed.terms.length === 0) return first;

    // 第二段：只保留二元组，放宽召回
    const relaxed = sanitizeTokens(bigramsOnly(baseTokens));
    if (relaxed.length === 0) return first;
    return run(relaxed, parsed, opts);
  };

  return {
    add,
    remove,
    search,
    get size() {
      return docs.size;
    },
    dispose() {
      docs.clear();
      indexes.clear();
    },
  };
}

function ridOf(hit: SearchHit): string {
  const prefix = hit.kind === 'article' ? 'a' : hit.kind === 'series' ? 's' : hit.kind === 'author' ? 'p' : 't';
  return `${prefix}:${hit.id}`;
}

function bigramsOf(token: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < token.length; i++) out.push(token.slice(i, i + 2));
  return out;
}
