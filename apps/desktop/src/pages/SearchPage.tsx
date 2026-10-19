import type { FilterKind } from '@tpr/core';
import { resolveTags } from '@tpr/core';
import { Button, EmptyState, HighlightedText, Panel, SectionHeading, cn } from '@tpr/ui';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { TagLinks } from '../components/TagLinks.js';
import { useServices } from '../context.js';
import { useLibraryContext } from '../library/LibraryProvider.js';
import { useSearch } from '../search/useSearch.js';
import { applyTagSuggestion, computeTagSuggestions, type TagSuggestion } from '../search/suggest.js';

const FILTERS: ReadonlyArray<{ value: FilterKind; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'short', label: '短篇' },
  { value: 'series', label: '系列' },
  { value: 'author', label: '作者' },
  { value: 'tag-character', label: '角色' },
  { value: 'tag-plot', label: '情节' },
];

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

export function SearchPage() {
  const services = useServices();
  const { status: libraryStatus, snapshot } = useLibraryContext();
  const search = useSearch(services, libraryStatus === 'ready');
  const [params, setParams] = useSearchParams();
  const queryParam = params.get('q') ?? '';
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);

  // 详情页的标签/作者链接用 /search?q=名字 跳进来（Goal 5）
  useEffect(() => {
    if (queryParam && queryParam !== search.query) search.setQuery(queryParam);
  }, [queryParam, search.query, search.setQuery]);

  const changeQuery = (value: string) => {
    search.setQuery(value);
    setParams(value ? { q: value } : {}, { replace: true });
  };

  const suggestion = useMemo(
    () => computeTagSuggestions(search.query, caret, snapshot?.tags ?? []),
    [search.query, caret, snapshot],
  );
  const open = focused && suggestion !== null;
  const activeIndex = suggestion ? Math.min(active, suggestion.items.length - 1) : 0;

  const applySuggestion = (item: TagSuggestion) => {
    if (!suggestion) return;
    const next = applyTagSuggestion(search.query, caret, suggestion, item.name);
    changeQuery(next.query);
    setActive(0);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(next.caret, next.caret);
      setCaret(next.caret);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open || !suggestion) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((value) => (value + 1) % suggestion.items.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((value) => (value - 1 + suggestion.items.length) % suggestion.items.length);
    } else if (event.key === 'Enter') {
      const item = suggestion.items[activeIndex];
      if (!item) return;
      event.preventDefault();
      applySuggestion(item);
    } else if (event.key === 'Escape') {
      setFocused(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <SectionHeading
        eyebrow="检索"
        title="搜索"
        description={`${search.status === 'indexing' ? '正在建索引…' : search.status === 'done' ? `${search.total} 条 · ${search.tookMs} ms · 索引 ${search.indexSize}` : '按标题、正文、作者、标签检索'}`}
      />

      <Panel className="p-4">
        <div className="relative">
          <input
            // biome-ignore lint/a11y/noAutofocus: 搜索页的主输入框
            autoFocus
            ref={inputRef}
            value={search.query}
            onChange={(event) => {
              changeQuery(event.target.value);
              setCaret(event.target.selectionStart ?? event.target.value.length);
            }}
            onKeyDown={onKeyDown}
            onKeyUp={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
            onClick={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
            onFocus={() => setFocused(true)}
            onBlur={() => window.setTimeout(() => setFocused(false), 120)}
            placeholder="标题、正文、作者、标签…（输入 # 可联想标签）"
            aria-label="搜索关键词"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls="search-tag-suggestions"
            className="w-full rounded-lg border border-border bg-surface/60 px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-accent focus:ring-2 focus:ring-[var(--ring)]"
          />
          {open && suggestion ? (
            <div
              id="search-tag-suggestions"
              role="listbox"
              aria-label="标签联想"
              className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-border bg-background shadow-xl"
            >
              {suggestion.items.map((item, index) => (
                <button
                  key={`${item.category}:${item.name}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applySuggestion(item)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                    index === activeIndex ? 'bg-accent-soft text-accent' : 'hover:bg-surface-strong',
                  )}
                >
                  <span className="font-medium">#{item.name}</span>
                  <span className="ml-auto text-[0.7rem] text-muted-foreground">{item.hint}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {FILTERS.map((item) => (
            <Button
              key={item.value}
              size="sm"
              variant={search.filter === item.value ? 'primary' : 'secondary'}
              aria-pressed={search.filter === item.value}
              onClick={() => search.setFilter(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </Panel>

      {libraryStatus !== 'ready' ? (
        <EmptyState
          title="还没有可搜索的数据库"
          description="先去首页导入一个 .tpr。"
          action={
            <Link to="/">
              <Button size="sm">回到首页</Button>
            </Link>
          }
        />
      ) : null}

      {search.error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">
          {search.error}
        </p>
      ) : null}

      {search.status === 'idle' && libraryStatus === 'ready' ? (
        <EmptyState
          icon="🔎"
          title="输入关键词开始搜索"
          description="试试 #已完结、#短篇文，或直接输入作者别名。"
        />
      ) : null}

      {search.status === 'running' && search.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">搜索中…</p>
      ) : null}

      {search.status === 'done' && search.total === 0 ? (
        <EmptyState icon="🍃" title="没有找到匹配项" description="换个关键词，或切换筛选条件。" />
      ) : null}

      {search.items.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface/70 shadow-sm backdrop-blur-sm">
          {search.items.map((item) => {
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

            return (
              <li
                key={`${item.kind}:${item.id}`}
                className="flex flex-col gap-1.5 px-4 py-3 transition-colors hover:bg-surface-strong/60"
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
                    {item.badges.map((badge) => (
                      <span
                        key={badge}
                        className="rounded-full border border-border px-2 py-0.5 text-[0.65rem] text-muted-foreground"
                      >
                        {badge}
                      </span>
                    ))}
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
                      {item.snippets.map((parts, index) => (
                        <HighlightedText
                          // biome-ignore lint/suspicious/noArrayIndexKey: 片段无语义 id
                          key={index}
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
          })}
        </ul>
      ) : null}
    </div>
  );
}
