import type { FilterKind } from '@tpr/core';
import { resolveTags } from '@tpr/core';
import { HighlightedText, cn } from '@tpr/ui';
import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import { TagLinks } from '../components/TagLinks.js';
import { useServices } from '../context.js';
import { useLibraryContext } from '../library/LibraryProvider.js';
import { useSearch } from '../search/useSearch.js';

const FILTERS: ReadonlyArray<{ value: FilterKind; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'short', label: '短篇' },
  { value: 'series', label: '系列' },
  { value: 'author', label: '作者' },
  { value: 'tag-character', label: '角色' },
  { value: 'tag-plot', label: '情节' },
];

const KIND_STYLE: Record<string, string> = {
  article: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  series: 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200',
  author: 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200',
  tag: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
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

  // 详情页的标签/作者链接用 /search?q=名字 跳进来（Goal 5）
  useEffect(() => {
    if (queryParam && queryParam !== search.query) search.setQuery(queryParam);
  }, [queryParam, search.query, search.setQuery]);

  const changeQuery = (value: string) => {
    search.setQuery(value);
    setParams(value ? { q: value } : {}, { replace: true });
  };

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-medium">搜索</h2>
        <input
          // biome-ignore lint/a11y/noAutofocus: 搜索页的主输入框
          autoFocus
          value={search.query}
          onChange={(event) => changeQuery(event.target.value)}
          placeholder="标题、正文、作者、标签…（支持 #已完结 #短篇文 #标签名）"
          aria-label="搜索关键词"
          className="w-full rounded-md border border-border bg-transparent px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/60"
        />
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => search.setFilter(item.value)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                search.filter === item.value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent',
              )}
            >
              {item.label}
            </button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">
            {search.status === 'indexing'
              ? '正在建索引…'
              : search.status === 'done'
                ? `${search.total} 条 · ${search.tookMs} ms · 索引 ${search.indexSize}`
                : null}
          </span>
        </div>
      </div>

      {libraryStatus !== 'ready' ? (
        <p className="rounded-md border border-border px-4 py-3 text-sm text-muted-foreground">
          还没有可搜索的数据库，先去
          <Link to="/" className="mx-1 underline underline-offset-2">
            导入一个 .tpr
          </Link>
          。
        </p>
      ) : null}

      {search.error ? (
        <p className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {search.error}
        </p>
      ) : null}

      {search.status === 'idle' && libraryStatus === 'ready' ? (
        <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          <p>输入关键词开始搜索。</p>
          <p className="mt-2 text-xs">
            试试 <code className="rounded bg-muted px-1">#已完结</code>、
            <code className="mx-1 rounded bg-muted px-1">#短篇文</code>，或直接输入作者别名。
          </p>
        </div>
      ) : null}

      {search.status === 'running' && search.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">搜索中…</p>
      ) : null}

      {search.status === 'done' && search.total === 0 ? (
        <p className="rounded-md border border-border px-4 py-6 text-center text-sm text-muted-foreground">
          没有找到匹配项。
        </p>
      ) : null}

      {search.items.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
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
              <li key={`${item.kind}:${item.id}`} className="flex flex-col gap-1.5 px-4 py-3">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[10px]',
                        KIND_STYLE[item.kind] ?? 'bg-muted text-muted-foreground',
                      )}
                    >
                      {KIND_LABEL[item.kind] ?? item.kind}
                    </span>
                    {item.badges.map((badge) => (
                      <span
                        key={badge}
                        className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {badge}
                      </span>
                    ))}
                    {to ? (
                      <Link to={to} className="truncate text-sm font-medium hover:underline">
                        {item.title}
                      </Link>
                    ) : (
                      <span className="truncate text-sm font-medium">{item.title}</span>
                    )}
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
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
    </section>
  );
}
