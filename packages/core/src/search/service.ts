/**
 * 搜索服务（design §11.7）：把「快照 + 正文」编成索引，并把命中翻译成可直接渲染的结果。
 *
 * 索引是懒构建的：第一次搜索或显式 `ready()` 时建好；库的 `revision` 变了就重建。
 * 结果里的片段优先来自正文（只在命中正文时读），否则退回简介，最后才读正文前 20 篇。
 */

import type { Library } from '../db/library.js';
import type { DBSnapshot } from '../db/snapshot.js';
import { articleSeriesPosition } from '../db/view.js';
import { buildSearchIndex } from './build.js';
import type { FilterKind, HitKind, SearchEngine, SearchHit } from './engine.js';
import { parseQuery } from './parse-query.js';
import { buildSnippets, type SnippetPart } from './snippet.js';

export interface SearchSeriesRef {
  id: string;
  title: string;
  status: 'ongoing' | 'completed';
  /** 文章在系列目录中的 1 基编号 */
  index: number;
  /** 系列目录总篇数 */
  total: number;
}

export interface SearchItem {
  kind: HitKind;
  id: string;
  title: string;
  subtitle: string;
  updatedAt: string;
  score: number;
  matchedFields: string[];
  badges: string[];
  snippets: SnippetPart[][];
  /** 仅文章条目有：所属系列与篇号，供结果页按系列折叠 */
  series?: SearchSeriesRef;
}

export interface SearchResponse {
  items: SearchItem[];
  total: number;
  tookMs: number;
  indexSize: number;
  /** 建索引时读不到正文的篇数（只用于日志/诊断） */
  missingContent: number;
}

export interface SearchService {
  /** 构建/重建索引；并发调用共享同一次构建。 */
  ready(): Promise<void>;
  search(
    query: string,
    opts?: { filter?: FilterKind; limit?: number; tags?: readonly string[] },
  ): Promise<SearchResponse>;
  /** 强制下次搜索重建索引（导入/编辑后调用）。 */
  invalidate(): void;
  readonly indexSize: number;
}

const BODY_READ_LIMIT = 20;
const SNIPPET_LIMIT = 120;

const KIND_LABEL: Record<HitKind, string> = {
  article: '文章',
  series: '系列',
  author: '作者',
  tag: '标签',
};

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

export function createSearchService(library: Library): SearchService {
  let engine: SearchEngine | null = null;
  let snapshot: DBSnapshot | null = null;
  let builtRevision = -1;
  let missingContent = 0;
  let building: Promise<void> | null = null;

  const rebuild = async (): Promise<void> => {
    const current = library.snapshot();
    const loaded = library.current();
    if (!current || !loaded) {
      engine?.dispose();
      engine = null;
      snapshot = null;
      builtRevision = -1;
      return;
    }
    engine?.dispose();
    const built = await buildSearchIndex(current, { content: loaded.contents });
    engine = built.engine;
    snapshot = current;
    missingContent = built.missingContent;
    builtRevision = library.revision;
  };

  const ready = (): Promise<void> => {
    if (engine && builtRevision === library.revision) return Promise.resolve();
    building ??= rebuild().finally(() => {
      building = null;
    });
    return building;
  };

  const badgesFor = (hit: SearchHit, snap: DBSnapshot): string[] => {
    if (hit.kind === 'article') {
      const article = snap.maps.articles.get(hit.id);
      const out = [article?.type === 'series-entry' ? '系列文' : '短篇文'];
      const series = article?.seriesId ? snap.maps.series.get(article.seriesId) : undefined;
      if (series) out.push(series.status === 'completed' ? '已完结' : '连载中');
      return out;
    }
    if (hit.kind === 'series') {
      const series = snap.maps.series.get(hit.id);
      return [series?.status === 'completed' ? '已完结' : '连载中'];
    }
    if (hit.kind === 'tag') {
      const tag = snap.maps.tags.get(hit.id);
      const label =
        tag?.category === 'character'
          ? '角色'
          : tag?.category === 'plot'
            ? '情节'
            : tag?.category === 'series'
              ? '系列'
              : '主题';
      return [label];
    }
    return ['作者'];
  };

  const titleFor = (hit: SearchHit, snap: DBSnapshot): { title: string; subtitle: string } => {
    switch (hit.kind) {
      case 'article': {
        const article = snap.maps.articles.get(hit.id);
        return { title: article?.title ?? hit.id, subtitle: article?.summary ?? '' };
      }
      case 'series': {
        const series = snap.maps.series.get(hit.id);
        return { title: series?.title ?? hit.id, subtitle: series?.summary ?? '' };
      }
      case 'author': {
        const author = snap.maps.authors.get(hit.id);
        return {
          title: author?.canonicalName ?? hit.id,
          subtitle: author?.aliases?.length ? `别名：${author.aliases.join('、')}` : '作者',
        };
      }
      case 'tag': {
        const tag = snap.maps.tags.get(hit.id);
        return {
          title: tag?.name ?? hit.id,
          subtitle: tag?.aliases?.length ? `别名：${tag.aliases.join('、')}` : KIND_LABEL.tag,
        };
      }
    }
  };

  const seriesRefFor = (hit: SearchHit, snap: DBSnapshot): SearchSeriesRef | undefined => {
    if (hit.kind !== 'article') return undefined;
    const position = articleSeriesPosition(snap, hit.id);
    if (!position) return undefined;
    return {
      id: position.series.id,
      title: position.series.title,
      status: position.series.status,
      index: position.index,
      total: position.series.articleIds.length,
    };
  };

  const snippetsFor = async (
    hit: SearchHit,
    snap: DBSnapshot,
    terms: readonly string[],
  ): Promise<SnippetPart[][]> => {
    if (hit.kind !== 'article') {
      const { subtitle } = titleFor(hit, snap);
      return subtitle ? buildSnippets(subtitle, terms) : [];
    }
    const article = snap.maps.articles.get(hit.id);
    const summary = article?.summary ?? '';
    const fromSummary = summary ? buildSnippets(summary, terms) : [];
    if (fromSummary.length > 0) return fromSummary;
    if (!hit.matchedFields.includes('body')) return [];
    try {
      const body = await library.readContent(hit.id);
      return buildSnippets(body, terms, { max: 2, radius: 40 });
    } catch {
      return [];
    }
  };

  const search = async (
    query: string,
    opts: { filter?: FilterKind; limit?: number; tags?: readonly string[] } = {},
  ): Promise<SearchResponse> => {
    await ready();
    const snap = snapshot;
    if (!snap || !engine) {
      return { items: [], total: 0, tookMs: 0, indexSize: 0, missingContent: 0 };
    }

    const started = performance.now();
    const limit = opts.limit ?? 50;
    const searchOptions = {
      ...(opts.filter ? { filter: opts.filter } : {}),
      ...(opts.tags && opts.tags.length > 0 ? { tags: opts.tags } : {}),
      limit,
    };
    const hits = engine.search(query, searchOptions);
    const parsed = parseQuery(query);
    const terms = [...parsed.phrases, ...parsed.terms].filter((term) => term.length > 0);

    const items: SearchItem[] = [];
    for (const [index, hit] of hits.entries()) {
      const { title, subtitle } = titleFor(hit, snap);
      const snippets =
        hit.kind === 'article' && index >= BODY_READ_LIMIT
          ? []
          : await snippetsFor(hit, snap, terms);
      const series = seriesRefFor(hit, snap);
      items.push({
        kind: hit.kind,
        id: hit.id,
        title,
        subtitle: truncate(subtitle, SNIPPET_LIMIT),
        updatedAt:
          hit.kind === 'article'
            ? (snap.maps.articles.get(hit.id)?.updatedAt ?? snap.manifest.updatedAt)
            : snap.manifest.updatedAt,
        score: hit.score,
        matchedFields: hit.matchedFields,
        badges: badgesFor(hit, snap),
        snippets,
        ...(series ? { series } : {}),
      });
    }

    return {
      items,
      total: items.length,
      tookMs: Math.round((performance.now() - started) * 10) / 10,
      indexSize: engine.size,
      missingContent,
    };
  };

  return {
    ready,
    search,
    invalidate() {
      builtRevision = -1;
    },
    get indexSize() {
      return engine?.size ?? 0;
    },
  };
}
