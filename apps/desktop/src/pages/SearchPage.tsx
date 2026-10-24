import type { FilterKind } from '@tpr/core';
import { Button, cn, EmptyState, Panel, SectionHeading } from '@tpr/ui';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useServices } from '../context.js';
import { useLibraryContext } from '../library/LibraryProvider.js';
import { SearchResults } from '../search/SearchResults.js';
import { SearchTagFilter } from '../search/SearchTagFilter.js';
import {
  applyTagSuggestion,
  computeTagSuggestions,
  type TagSuggestion,
} from '../search/suggest.js';
import { normalizeSelectedTags, toggleSelectedTag } from '../search/tags.js';
import { useSearch } from '../search/useSearch.js';

const FILTERS: ReadonlyArray<{ value: FilterKind; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'short', label: '短篇' },
  { value: 'series', label: '系列' },
  { value: 'author', label: '作者' },
  { value: 'tag-character', label: '角色' },
  { value: 'tag-plot', label: '情节' },
];

export function SearchPage() {
  const services = useServices();
  const { status: libraryStatus, snapshot } = useLibraryContext();
  const search = useSearch(services, libraryStatus === 'ready');
  const [params, setParams] = useSearchParams();
  const queryParam = params.get('q') ?? '';
  const tagParamKey = JSON.stringify(params.getAll('tag'));
  const tagParams = useMemo(
    () => normalizeSelectedTags(JSON.parse(tagParamKey) as string[]),
    [tagParamKey],
  );
  const tagSelectionKey = JSON.stringify(tagParams);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);

  // URL -> 搜索状态：只在 URL 真正变化时同步，避免输入过程中被旧 URL 回滚。
  const appliedUrl = useRef<string | null>(null);
  useEffect(() => {
    const urlKey = JSON.stringify([queryParam, tagParamKey]);
    if (appliedUrl.current === urlKey) return;
    appliedUrl.current = urlKey;
    if (queryParam !== search.query) search.setQuery(queryParam);
    if (tagSelectionKey !== JSON.stringify(search.tags)) search.setTags(tagParams);
  }, [
    queryParam,
    tagParamKey,
    tagParams,
    tagSelectionKey,
    search.query,
    search.tags,
    search.setQuery,
    search.setTags,
  ]);

  // URL 只写入非空 q，每个标签一个 tag 参数（Goal 25）。
  const syncParams = (nextQuery: string, nextTags: readonly string[]) => {
    const next = new URLSearchParams();
    if (nextQuery) next.set('q', nextQuery);
    for (const tag of nextTags) next.append('tag', tag);
    setParams(next, { replace: true });
  };

  const changeQuery = (value: string) => {
    search.setQuery(value);
    syncParams(value, search.tags);
  };

  const changeTags = (values: readonly string[]) => {
    const next = normalizeSelectedTags(values);
    search.setTags(next);
    syncParams(search.query, next);
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
            role="combobox"
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
                    index === activeIndex
                      ? 'bg-accent-soft text-accent'
                      : 'hover:bg-surface-strong',
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
        <div className="mt-3 border-t border-border pt-3">
          <SearchTagFilter
            tags={snapshot?.tags ?? []}
            selected={search.tags}
            onToggle={(name) => changeTags(toggleSelectedTag(search.tags, name))}
            onClear={() => changeTags([])}
          />
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

      {search.status === 'idle' && search.tags.length === 0 && libraryStatus === 'ready' ? (
        <EmptyState
          icon="🔎"
          title="输入关键词或选择标签开始搜索"
          description="试试 #已完结、#短篇文，或同时选择多个标签。"
        />
      ) : null}

      {(search.status === 'running' || (search.status === 'idle' && search.tags.length > 0)) &&
      search.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">搜索中…</p>
      ) : null}

      {search.status === 'done' && search.total === 0 ? (
        <EmptyState
          icon="🍃"
          title="没有找到匹配项"
          description="换个关键词、减少标签，或切换筛选条件。"
        />
      ) : null}

      {search.items.length > 0 ? <SearchResults items={search.items} snapshot={snapshot} /> : null}
    </div>
  );
}
