import type { ArticleMeta } from '@tpr/schema';
import { articleSeriesPosition, resolveTags } from '@tpr/core';
import { Button, EmptyState, SectionHeading, cn } from '@tpr/ui';
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
    <div className="flex flex-col gap-5">
      <SectionHeading
        eyebrow="浏览"
        title="文章库"
        description={`共 ${snapshot?.articles.length ?? 0} 篇；点标签可按该标签搜索，点击封面或标题进入详情。`}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="按标题、简介、标签过滤…"
          aria-label="过滤文章"
          className="w-full rounded-lg border border-border bg-surface/60 px-4 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-accent focus:ring-2 focus:ring-[var(--ring)]"
        />
        <div className="flex shrink-0 flex-wrap gap-2">
          {TYPE_FILTERS.map((item) => (
            <Button
              key={item.value}
              size="sm"
              variant={type === item.value ? 'primary' : 'secondary'}
              aria-pressed={type === item.value}
              onClick={() => setType(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>

      {status === 'loading' && <p className="text-sm text-muted-foreground">载入中…</p>}

      {status === 'ready' && !snapshot && (
        <EmptyState
          title="还没有导入数据库"
          description="先去首页拖入一个 .tpr，或从 GitHub 下载。"
          action={
            <Link to="/import">
              <Button size="sm">去导入</Button>
            </Link>
          }
        />
      )}

      {status === 'ready' && snapshot && articles.length === 0 && (
        <EmptyState
          icon="🔍"
          title={query.trim() ? '没有匹配的文章' : '这个数据库还没有文章'}
          description={query.trim() ? '换个关键词，或清空过滤条件。' : '可以在编辑器里新建一篇。'}
        />
      )}

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {articles.map((article) => {
          const series = article.seriesId ? snapshot?.maps.series.get(article.seriesId) : undefined;
          const position = snapshot ? articleSeriesPosition(snapshot, article.id) : null;
          const cover = article.coverImageId ? snapshot?.maps.images.get(article.coverImageId) : undefined;
          const tags = snapshot ? resolveTags(snapshot, [...article.characterTagIds, ...article.plotTagIds]) : [];

          return (
            <li
              key={article.id}
              className="group flex flex-col overflow-hidden rounded-xl border border-border bg-surface/70 shadow-sm backdrop-blur-sm transition-shadow hover:shadow-md"
            >
              <Link
                to={`/article/${article.id}`}
                className="flex h-44 items-center justify-center overflow-hidden bg-muted/40"
                aria-label={`阅读《${article.title}》`}
              >
                {cover ? (
                  <img
                    src={toUrl(cover.file)}
                    alt={cover.caption ?? article.title}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    loading="lazy"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">无封面</span>
                )}
              </Link>

              <div className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex items-center gap-2 text-[0.68rem] text-muted-foreground">
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 font-medium',
                      article.type === 'short'
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
                    )}
                  >
                    {TYPE_LABEL[article.type]}
                  </span>
                  {position ? (
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent">
                      第 {position.index} 篇
                    </span>
                  ) : null}
                  {series ? (
                    <Link to={`/series/${series.id}`} className="truncate hover:text-accent">
                      {series.title}
                    </Link>
                  ) : null}
                  <span className="ml-auto shrink-0">{article.updatedAt.slice(0, 10)}</span>
                </div>

                <Link
                  to={`/article/${article.id}`}
                  className="truncate text-sm font-medium group-hover:text-accent"
                >
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
    </div>
  );
}
