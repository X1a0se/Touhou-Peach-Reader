import { getSeriesView, resolveTags } from '@tpr/core';
import { cn } from '@tpr/ui';
import { FavoriteButton } from '../components/FavoriteButton.js';
import { TagLinks } from '../components/TagLinks.js';
import { Link, useParams } from 'react-router';
import { useServices } from '../context.js';
import { useLibraryContext } from '../library/LibraryProvider.js';

const STATUS_LABEL: Record<string, string> = {
  ongoing: '连载中',
  completed: '已完结',
};

const STATUS_STYLE: Record<string, string> = {
  ongoing: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200',
  completed:
    'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
};

export function SeriesPage() {
  const { id = '' } = useParams();
  const services = useServices();
  const { snapshot, status } = useLibraryContext();

  const loaded = services.library.current();
  const view = snapshot && loaded ? getSeriesView(snapshot, id, { dir: loaded.dir, join: services.platform.paths.join }) : null;

  if (status === 'loading') {
    return <p className="text-sm text-muted-foreground">载入中…</p>;
  }

  if (!view) {
    return (
      <section className="flex flex-col gap-4">
        <nav className="text-sm text-muted-foreground">
          <Link to="/" className="underline underline-offset-2">
            首页
          </Link>
        </nav>
        <p className="rounded-md border border-border px-4 py-6 text-center text-sm text-muted-foreground">
          找不到这个系列（{id}）。
        </p>
      </section>
    );
  }

  const { series } = view;
  const toUrl = (path: string) => services.platform.assets.toUrl(path);

  return (
    <article className="flex flex-col gap-6">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link to="/" className="underline underline-offset-2 hover:text-foreground">
          首页
        </Link>
        <span>/</span>
        <Link to="/search" className="underline underline-offset-2 hover:text-foreground">
          搜索
        </Link>
      </nav>

      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded bg-violet-100 px-1.5 py-0.5 text-violet-800 dark:bg-violet-900 dark:text-violet-200">
            系列
          </span>
          <span className={cn('rounded-full border px-2 py-0.5', STATUS_STYLE[series.status] ?? 'border-border')}>
            {STATUS_LABEL[series.status] ?? series.status}
          </span>
          <span className="ml-auto flex items-center gap-2">
            <FavoriteButton kind="series" id={series.id} />
            <span className="font-mono text-[10px] text-muted-foreground">{series.id}</span>
          </span>
        </div>
        <h1 className="text-2xl font-semibold text-foreground">{series.title}</h1>
        {series.summary ? <p className="text-sm leading-6 text-muted-foreground">{series.summary}</p> : null}
        <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
          {view.authors.length > 0 ? (
            <>
              <dt className="text-muted-foreground">作者</dt>
              <dd className="text-foreground">{view.authors.map((person) => person.name).join('、')}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">篇数</dt>
          <dd className="text-foreground">{view.articles.length}</dd>
          <dt className="text-muted-foreground">更新</dt>
          <dd className="text-foreground">{series.updatedAt.slice(0, 10)}</dd>
          {view.sourceUrl ? (
            <>
              <dt className="text-muted-foreground">原出处</dt>
              <dd>
                <button
                  type="button"
                  onClick={() => {
                    if (view.sourceUrl) void services.platform.opener.openExternal(view.sourceUrl);
                  }}
                  className="break-all text-left text-sm text-rose-700 underline underline-offset-2 hover:text-rose-800 dark:text-rose-300"
                >
                  {view.sourceUrl}
                </button>
              </dd>
            </>
          ) : null}
        </dl>
      </header>

      {view.cover ? (
        <img
          src={toUrl(view.cover.path)}
          alt={view.cover.caption ?? '封面'}
          className="max-h-80 w-full rounded-lg border border-border object-cover"
          loading="lazy"
        />
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">目录</h2>
        {view.articles.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            这个系列还没有收录文章。
          </p>
        ) : (
          <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {view.articles.map((article, index) => (
              <li key={article.id} className="flex flex-col gap-1 px-4 py-3">
                <Link
                  to={`/article/${article.id}`}
                  className="flex items-baseline gap-3 text-sm hover:underline"
                >
                  <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-foreground">{index + 1}</span>
                  <span className="truncate font-medium">{article.title}</span>
                  {article.summary ? (
                    <span className="ml-2 hidden truncate text-xs text-muted-foreground sm:inline">{article.summary}</span>
                  ) : null}
                </Link>
                <TagLinks
                  tags={snapshot ? resolveTags(snapshot, [...article.characterTagIds, ...article.plotTagIds]) : []}
                  limit={4}
                  className="pl-9"
                />
              </li>
            ))}
          </ol>
        )}
      </section>

      {view.characterTags.length > 0 || view.plotTags.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">标签</h2>
          <div className="flex flex-wrap gap-2">
            {[...view.characterTags, ...view.plotTags].map((tag) => (
              <Link
                key={tag.id}
                to={`/search?q=${encodeURIComponent(tag.name)}`}
                className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-accent"
              >
                {tag.name}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </article>
  );
}
