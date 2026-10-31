import type { DBSnapshot, SearchItem, SearchResultRow } from '@tpr/core';
import { groupSearchItems, hasR18PlotTag, resolveTags } from '@tpr/core';
import { Button, cn, HighlightedText, R18Badge } from '@tpr/ui';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { TagLinks } from '../components/TagLinks.js';

const KIND_STYLE: Record<string, string> = {
  article: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  series: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  author: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  tag: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
};

const KIND_LABEL: Record<string, string> = {
  article: '文章',
  series: '系列',
  author: '作者',
  tag: '标签',
};

function ResultRow({
  item,
  snapshot,
  index,
  nested = false,
}: {
  item: SearchItem;
  snapshot: DBSnapshot | null;
  index?: number | undefined;
  nested?: boolean;
}) {
  const to =
    item.kind === 'article'
      ? `/article/${item.id}`
      : item.kind === 'series'
        ? `/series/${item.id}`
        : null;
  const article = item.kind === 'article' ? snapshot?.maps.articles.get(item.id) : undefined;
  const series = item.kind === 'series' ? snapshot?.maps.series.get(item.id) : undefined;
  const tags =
    snapshot && article
      ? resolveTags(snapshot, [...article.characterTagIds, ...article.plotTagIds])
      : snapshot && series
        ? resolveTags(snapshot, [...series.characterTagIds, ...series.plotTagIds])
        : [];
  const r18 =
    snapshot && article
      ? hasR18PlotTag(snapshot, article.plotTagIds)
      : snapshot && series
        ? hasR18PlotTag(snapshot, series.plotTagIds)
        : false;

  return (
    <li
      className={cn(
        'flex flex-col gap-1.5 px-4 py-3 transition-colors hover:bg-surface-strong/60',
        nested ? 'bg-surface/30 pl-8' : null,
      )}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[0.65rem] font-medium',
              KIND_STYLE[item.kind] ?? 'bg-muted text-muted-foreground',
            )}
          >
            {KIND_LABEL[item.kind] ?? item.kind}
          </span>
          {index !== undefined ? (
            <span className="shrink-0 text-[0.65rem] text-muted-foreground">第 {index} 篇</span>
          ) : null}
          {item.badges.map((badge) => (
            <span
              key={badge}
              className="rounded-full border border-border px-2 py-0.5 text-[0.65rem] text-muted-foreground"
            >
              {badge}
            </span>
          ))}
          {r18 ? <R18Badge /> : null}
          {to ? (
            <Link to={to} className="truncate text-sm font-medium hover:text-accent">
              {item.title}
            </Link>
          ) : (
            <span className="truncate text-sm font-medium">{item.title}</span>
          )}
          <span className="ml-auto shrink-0 font-mono text-[0.65rem] text-muted-foreground">
            {item.id}
          </span>
        </div>

        {item.snippets.length > 0 ? (
          <div className="flex flex-col gap-1 text-xs">
            {item.snippets.map((parts, snippetIndex) => (
              <HighlightedText
                // biome-ignore lint/suspicious/noArrayIndexKey: 片段无语义 id
                key={snippetIndex}
                parts={parts}
              />
            ))}
          </div>
        ) : item.subtitle ? (
          <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p>
        ) : null}
      </div>

      <TagLinks tags={tags} limit={6} />
    </li>
  );
}

function SeriesGroup({
  series,
  items,
  seriesItem,
  snapshot,
  expanded,
  onToggle,
}: {
  series: NonNullable<SearchItem['series']>;
  items: readonly SearchItem[];
  seriesItem: SearchItem | undefined;
  snapshot: DBSnapshot | null;
  expanded: boolean;
  onToggle(): void;
}) {
  const panelId = `search-series-${series.id}`;
  const entity = snapshot?.maps.series.get(series.id);
  const tags =
    snapshot && entity
      ? resolveTags(snapshot, [...entity.characterTagIds, ...entity.plotTagIds])
      : [];
  const r18 = snapshot && entity ? hasR18PlotTag(snapshot, entity.plotTagIds) : false;

  return (
    <li className="flex flex-col">
      <div className="flex flex-col gap-1.5 px-4 py-3 transition-colors hover:bg-surface-strong/60">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[0.65rem] font-medium text-violet-700 dark:text-violet-300">
            系列
          </span>
          <span className="rounded-full border border-border px-2 py-0.5 text-[0.65rem] text-muted-foreground">
            {series.status === 'completed' ? '已完结' : '连载中'}
          </span>
          {r18 ? <R18Badge /> : null}
          <Link
            to={`/series/${series.id}`}
            className="truncate text-sm font-medium hover:text-accent"
          >
            {series.title}
          </Link>
          <span className="shrink-0 text-[0.65rem] text-muted-foreground">
            命中 {items.length} 篇 · 共 {series.total} 篇
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="ml-auto shrink-0"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={onToggle}
          >
            {expanded ? '收起' : `展开 ${items.length} 篇`}
          </Button>
        </div>

        {seriesItem && seriesItem.snippets.length > 0 ? (
          <div className="flex flex-col gap-1 text-xs">
            {seriesItem.snippets.map((parts, snippetIndex) => (
              <HighlightedText
                // biome-ignore lint/suspicious/noArrayIndexKey: 片段无语义 id
                key={snippetIndex}
                parts={parts}
              />
            ))}
          </div>
        ) : seriesItem?.subtitle ? (
          <p className="truncate text-xs text-muted-foreground">{seriesItem.subtitle}</p>
        ) : null}

        <TagLinks tags={tags} limit={6} />
      </div>

      <ul id={panelId} hidden={!expanded} className="divide-y divide-border border-t border-border">
        {items.map((item) => (
          <ResultRow
            key={`${item.kind}:${item.id}`}
            item={item}
            snapshot={snapshot}
            index={item.series?.index}
            nested
          />
        ))}
      </ul>
    </li>
  );
}

function SearchResultList({
  rows,
  snapshot,
}: {
  rows: readonly SearchResultRow[];
  snapshot: DBSnapshot | null;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface/70 shadow-sm backdrop-blur-sm">
      {rows.map((row) =>
        row.kind === 'item' ? (
          <ResultRow key={`${row.item.kind}:${row.item.id}`} item={row.item} snapshot={snapshot} />
        ) : (
          <SeriesGroup
            key={`series:${row.series.id}`}
            series={row.series}
            items={row.items}
            seriesItem={row.seriesItem}
            snapshot={snapshot}
            expanded={expanded.has(row.series.id)}
            onToggle={() => toggle(row.series.id)}
          />
        ),
      )}
    </ul>
  );
}

/**
 * 搜索结果列表（Goal 25）：普通命中保持原样；同一系列 >=2 篇时折叠成一组，默认收起。
 * 分组函数在 core 里，组件只负责展开状态与渲染；结果集合变化时用 key 重建列表，
 * 从而重置展开状态，避免额外的 effect。
 */
export function SearchResults({
  items,
  snapshot,
}: {
  items: readonly SearchItem[];
  snapshot: DBSnapshot | null;
}) {
  const rows = useMemo(() => groupSearchItems(items), [items]);
  const resultKey = useMemo(
    () =>
      rows
        .map((row) =>
          row.kind === 'item' ? `${row.item.kind}:${row.item.id}` : `series:${row.series.id}`,
        )
        .join('|'),
    [rows],
  );

  return <SearchResultList key={resultKey} rows={rows} snapshot={snapshot} />;
}
