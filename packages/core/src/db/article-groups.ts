/**
 * 文章库的同系列折叠（展示层）。
 *
 * 与搜索页的 groupSearchItems 同一思路：分组只改变展示，不改变调用方给出的顺序。
 * 只有同一个系列在当前列表里出现 >= ARTICLE_SERIES_GROUP_MIN 篇时才成组；
 * 悬空 seriesId、以及不足两篇的系列保持单篇卡片。
 */
import type { ArticleMeta, Series } from '@tpr/schema';
import type { DBSnapshot } from './snapshot.js';

export const ARTICLE_SERIES_GROUP_MIN = 2;

export interface ArticleListItem {
  article: ArticleMeta;
  /** 系列目录内的 1 基序号；短篇或不在目录里为 null */
  position: number | null;
}

export type ArticleListRow =
  | { kind: 'article'; item: ArticleListItem }
  | { kind: 'group'; series: Series; items: readonly ArticleListItem[] };

function positionInSeries(series: Series, articleId: string): number | null {
  const index = series.articleIds.indexOf(articleId);
  return index >= 0 ? index + 1 : null;
}

/**
 * 按 seriesId 把当前文章列表折叠成「单篇 / 系列组」两种行。
 * 组行出现在该系列第一个成员的位置，组内保持入参顺序；不会修改入参。
 */
export function groupArticlesBySeries(
  snapshot: DBSnapshot,
  articles: readonly ArticleMeta[],
): ArticleListRow[] {
  const members = new Map<string, ArticleMeta[]>();
  for (const article of articles) {
    if (!article.seriesId || !snapshot.maps.series.has(article.seriesId)) continue;
    const list = members.get(article.seriesId);
    if (list) list.push(article);
    else members.set(article.seriesId, [article]);
  }

  const grouped = new Set(
    [...members.entries()]
      .filter(([, list]) => list.length >= ARTICLE_SERIES_GROUP_MIN)
      .map(([id]) => id),
  );

  const emitted = new Set<string>();
  const rows: ArticleListRow[] = [];
  for (const article of articles) {
    const seriesId = article.seriesId;
    if (seriesId && grouped.has(seriesId)) {
      if (emitted.has(seriesId)) continue;
      emitted.add(seriesId);
      const series = snapshot.maps.series.get(seriesId);
      if (series) {
        rows.push({
          kind: 'group',
          series,
          items: (members.get(seriesId) ?? []).map((item) => ({
            article: item,
            position: positionInSeries(series, item.id),
          })),
        });
        continue;
      }
    }
    const series = seriesId ? snapshot.maps.series.get(seriesId) : undefined;
    rows.push({
      kind: 'article',
      item: { article, position: series ? positionInSeries(series, article.id) : null },
    });
  }
  return rows;
}
