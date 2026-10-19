import type { ArticleMeta } from '@tpr/schema';
import { resolveTags } from '@tpr/core';
import { cn } from '@tpr/ui';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { TagLinks } from '../components/TagLinks.js';
import { useServices } from '../context.js';
import { useLibraryContext } from '../library/LibraryProvider.js';

type TypeFilter = 'all' | 'short' | 'series-entry';

const TYPE_FILTERS: ReadonlyArray<{ value: TypeFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'short', label: '短篇' },
  { value: 'series-entry', label: '系列' },
];

const TYPE_LABEL: Record<ArticleMeta['type'], string> = {
  short: '短篇',
  'series-entry': '系列',
};

export function ArticlesPage() {
  const services = useServices();
  const { snapshot, status } = useLibraryContext();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<TypeFilter>('all');

  const loaded = services.library.current();
  const toUrl = (file: string): string =>
    loaded ? services.platform.assets.toUrl(services.platform.paths.join(loaded.dir, file)) : '';

  const articles = useMemo(() => {
    if (!snapshot) return [];
    const needle = query.trim().toLowerCase();
    return snapshot.articles
      .filter((article) => (type === 'all' ? true : article.type === type))
      .filter((article) => {
        if (!needle) return true;
        if (article.title.toLowerCase().includes(needle)) return true;
        if (article.summary.toLowerCase().includes(needle)) return true;
        return resolveTags(snapshot, [...article.characterTagIds, ...article.plotTagIds]).some((tag) =>
          tag.name.toLowerCase().includes(needle),
        );
      })
      .slice()
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id.localeCompare(b.id)));
  }, [snapshot, query, type]);

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-medium">文章库</h2>
        <p className="text-xs text-muted-foreground">
          共 {snapshot?.articles.length ?? 0} 篇；点标签可按该标签搜索，点击封面或标题进入详情。
        </p>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="按标题、简介、标签过滤…"
          aria-label="过滤文章"
          className="w-full rounded-md border border-border bg-transparent px-4 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/60"
        />
        <div className="flex shrink-0 flex-wrap gap-2">
          {TYPE_FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setType(item.value)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                type === item.value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {status === 'loading' ? <p className="text-sm text-muted-foreground">载入中…</p> : null}

      {status === 'ready' && !snapshot ? (
        <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          还没有导入数据库，先去首页拖入一个 .tpr。
        </p>
      ) : null}

      {status === 'ready' && snapshot && articles.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {query.trim() ? '没有匹配的文章。' : '这个数据库还没有文章。'}
        </p>
      ) : null}

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {articles.map((article) => {
          const series = article.seriesId ? snapshot?.maps.series.get(article.seriesId) : undefined;
          const cover = article.coverImageId ? snapshot?.maps.images.get(article.coverImageId) : undefined;
          const tags = snapshot ? resolveTags(snapshot, [...article.characterTagIds, ...article.plotTagIds]) : [];

          return (
            <li key={article.id} className="flex flex-col overflow-hidden rounded-lg border border-border">
              <Link
                to={`/article/${article.id}`}
                className="flex h-44 items-center justify-center overflow-hidden bg-muted/40"
                aria-label={`阅读《${article.title}》`}
              >
                {cover ? (
                  <img
                    src={toUrl(cover.file)}
                    alt={cover.caption ?? article.title}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">无封面</span>
                )}
              </Link>

              <div className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[10px]',
                      article.type === 'short'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
                        : 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200',
                    )}
                  >
                    {TYPE_LABEL[article.type]}
                  </span>
                  {series ? (
                    <Link to={`/series/${series.id}`} className="truncate underline underline-offset-2">
                      {series.title}
                    </Link>
                  ) : null}
                  <span className="ml-auto shrink-0">{article.updatedAt.slice(0, 10)}</span>
                </div>

                <Link to={`/article/${article.id}`} className="truncate text-sm font-medium hover:underline">
                  {article.title}
                </Link>
                {article.summary ? (
                  <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{article.summary}</p>
                ) : null}

                <TagLinks tags={tags} className="mt-auto pt-1" />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
