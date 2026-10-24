/**
 * 搜索结果按系列折叠（Goal 25）。
 *
 * 同一系列命中的多篇文章在结果页只占一个位置：默认折叠，展开后按原排名顺序列出。
 * 系列实体（kind='series'）如果也命中，会被吸收进组头，不再单独占一行。
 * 分组只改变展示，不改变引擎给出的排名；只有命中 >=2 篇时才成组。
 */
import type { SearchItem, SearchSeriesRef } from './service.js';

export const SERIES_GROUP_MIN = 2;

export type SearchResultRow =
  | { kind: 'item'; item: SearchItem }
  | {
      kind: 'group';
      series: SearchSeriesRef;
      items: readonly SearchItem[];
      seriesItem?: SearchItem;
    };

export function groupSearchItems(items: readonly SearchItem[]): SearchResultRow[] {
  const members = new Map<string, SearchItem[]>();
  const refs = new Map<string, SearchSeriesRef>();
  const seriesItems = new Map<string, SearchItem>();

  for (const item of items) {
    if (item.kind === 'series') {
      seriesItems.set(item.id, item);
      continue;
    }
    if (item.kind !== 'article' || !item.series) continue;
    const id = item.series.id;
    const list = members.get(id);
    if (list) list.push(item);
    else members.set(id, [item]);
    if (!refs.has(id)) refs.set(id, item.series);
  }

  const grouped = new Set(
    [...members.entries()].filter(([, list]) => list.length >= SERIES_GROUP_MIN).map(([id]) => id),
  );
  if (grouped.size === 0) return items.map((item) => ({ kind: 'item', item }));

  const emitted = new Set<string>();
  const rows: SearchResultRow[] = [];
  for (const item of items) {
    if (item.kind === 'article' && item.series && grouped.has(item.series.id)) {
      const id = item.series.id;
      if (emitted.has(id)) continue;
      emitted.add(id);
      const seriesItem = seriesItems.get(id);
      rows.push({
        kind: 'group',
        series: refs.get(id) ?? item.series,
        items: members.get(id) ?? [],
        ...(seriesItem ? { seriesItem } : {}),
      });
      continue;
    }
    if (item.kind === 'series' && grouped.has(item.id)) {
      if (emitted.has(item.id)) continue;
      const ref = refs.get(item.id);
      if (!ref) {
        rows.push({ kind: 'item', item });
        continue;
      }
      emitted.add(item.id);
      rows.push({
        kind: 'group',
        series: ref,
        items: members.get(item.id) ?? [],
        seriesItem: item,
      });
      continue;
    }
    rows.push({ kind: 'item', item });
  }
  return rows;
}
