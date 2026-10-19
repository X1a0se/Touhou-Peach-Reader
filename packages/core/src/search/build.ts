/**
 * 从快照建搜索索引（design §11.3）。
 *
 * - 作者/标签实体也会进索引，供「作者 / 角色 / 情节」筛选
 * - 文章正文按需从 ContentStore 读，读完只留 token，不留原文
 * - 每 `chunk` 篇让出一次事件循环，避免长任务冻结 UI
 */
import type { DBSnapshot, IdMaps } from '../db/snapshot.js';
import type { ContentStore } from '../db/content-store.js';
import { type SearchDoc, type SearchEngine, createSearchEngine } from './engine.js';
import { tokenizeZh } from './tokenize.js';

export interface BuildSearchOptions {
  content: ContentStore;
  onProgress?: (done: number, total: number) => void;
  chunk?: number;
  signal?: AbortSignal;
}

export interface BuildSearchResult {
  engine: SearchEngine;
  /** 建索引时跳过的正文（缺失/读取失败）篇数 */
  missingContent: number;
}

const VIRTUAL_LABEL: Record<string, string> = {
  'v:short': '短篇文',
  'v:series-entry': '系列文',
  'v:completed': '已完结',
  'v:ongoing': '连载中',
};

function namesAndAliases(entity: {
  canonicalName?: string | undefined;
  name?: string | undefined;
  aliases?: readonly string[] | undefined;
}): string[] {
  const primary = entity.canonicalName ?? entity.name ?? '';
  return [primary, ...(entity.aliases ?? [])].filter(Boolean);
}

function virtualLabels(tags: readonly string[]): string[] {
  return tags.map((tag) => VIRTUAL_LABEL[tag] ?? tag);
}

export async function buildSearchIndex(
  snapshot: DBSnapshot,
  opts: BuildSearchOptions,
): Promise<BuildSearchResult> {
  const { content } = opts;
  const chunk = opts.chunk ?? 200;
  const engine = createSearchEngine();
  const { maps } = snapshot;

  const docs: SearchDoc[] = [];

  for (const author of snapshot.authors) {
    const names = namesAndAliases(author);
    docs.push({
      rid: `p:${author.id}`,
      kind: 'author',
      id: author.id,
      updatedAt: snapshot.manifest.updatedAt,
      virtual: [],
      tagNames: [],
      tokens: {
        title: tokenizeZh(author.canonicalName),
        people: tokenizeZh(names.join(' ')),
      },
    });
  }

  for (const tag of snapshot.tags) {
    const names = namesAndAliases({ name: tag.name, aliases: tag.aliases });
    docs.push({
      rid: `t:${tag.id}`,
      kind: 'tag',
      id: tag.id,
      updatedAt: snapshot.manifest.updatedAt,
      virtual: [],
      tagNames: [tag.name.normalize('NFKC').toLowerCase()],
      category: tag.category,
      tokens: {
        title: tokenizeZh(tag.name),
        tags: tokenizeZh(names.join(' ')),
      },
    });
  }

  const seriesById = maps.series;
  const tagNameById = (id: string): string => maps.tags.get(id)?.name ?? '';
  const personNames = (ids: readonly string[]): string[] =>
    ids.flatMap((id) => {
      const author = maps.authors.get(id);
      return author ? namesAndAliases(author) : [];
    });

  for (const series of snapshot.series) {
    const tags = [...series.characterTagIds, ...series.plotTagIds].map(tagNameById).filter(Boolean);
    const virtual = [series.status === 'completed' ? 'v:completed' : 'v:ongoing'];
    docs.push({
      rid: `s:${series.id}`,
      kind: 'series',
      id: series.id,
      updatedAt: series.updatedAt,
      virtual,
      tagNames: tags.map((name) => name.normalize('NFKC').toLowerCase()),
      tokens: {
        title: tokenizeZh(series.title),
        summary: tokenizeZh(series.summary ?? ''),
        people: tokenizeZh(
          [...personNames(series.authorIds), ...personNames(series.translatorIds)].join(' '),
        ),
        tags: tokenizeZh([...tags, ...virtualLabels(virtual)].join(' ')),
      },
    });
  }

  const total = snapshot.articles.length;
  let done = 0;
  let missingContent = 0;

  for (const article of snapshot.articles) {
    if (opts.signal?.aborted) break;

    let body = '';
    try {
      body = await content.read(article.id);
    } catch {
      missingContent += 1;
    }

    const tags = [...article.characterTagIds, ...article.plotTagIds].map(tagNameById).filter(Boolean);
    const virtual: string[] = [article.type === 'short' ? 'v:short' : 'v:series-entry'];
    const series = article.seriesId ? seriesById.get(article.seriesId) : undefined;
    if (series) virtual.push(series.status === 'completed' ? 'v:completed' : 'v:ongoing');

    docs.push({
      rid: `a:${article.id}`,
      kind: 'article',
      id: article.id,
      updatedAt: article.updatedAt,
      virtual,
      tagNames: tags.map((name) => name.normalize('NFKC').toLowerCase()),
      tokens: {
        title: tokenizeZh(article.title),
        summary: tokenizeZh(article.summary ?? ''),
        body: tokenizeZh(body),
        people: tokenizeZh(
          [...personNames(article.authorIds), ...personNames(article.translatorIds)].join(' '),
        ),
        tags: tokenizeZh([...tags, ...virtualLabels(virtual)].join(' ')),
      },
    });

    done += 1;
    if (done % chunk === 0) {
      opts.onProgress?.(done, total);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  opts.onProgress?.(done, total);
  engine.add(docs);
  return { engine, missingContent };
}

/** 从快照里按 rid 找回实体，供结果页展示（design §11.7） */
export function resolveHit(snapshot: DBSnapshot, kind: string, id: string): ArticleLike | undefined {
  const maps: IdMaps = snapshot.maps;
  if (kind === 'article') return maps.articles.get(id);
  if (kind === 'series') return maps.series.get(id);
  if (kind === 'author') return maps.authors.get(id);
  if (kind === 'tag') return maps.tags.get(id);
  return undefined;
}

export type ArticleLike =
  | DBSnapshot['articles'][number]
  | DBSnapshot['series'][number]
  | DBSnapshot['authors'][number]
  | DBSnapshot['tags'][number];
