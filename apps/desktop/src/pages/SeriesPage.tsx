import { getSeriesView, hasR18PlotTag, resolveTags } from '@tpr/core';
import { Button, EmptyState, Panel, R18Badge, SectionHeading, TagChip, cn } from '@tpr/ui';
import { Link, useParams } from 'react-router';
import { FavoriteButton } from '../components/FavoriteButton.js';
import { TagLinks } from '../components/TagLinks.js';
import { useServices } from '../context.js';
import { useLibraryContext } from '../library/LibraryProvider.js';
import { imageSource } from '../lib/images.js';

const STATUS_LABEL: Record<string, string> = {
  ongoing: '连载中',
  completed: '已完结',
};

const STATUS_STYLE: Record<string, string> = {
  ongoing: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
};

export function SeriesPage() {
  const { id = '' } = useParams();
  const services = useServices();
  const { snapshot, status } = useLibraryContext();

  const loaded = services.library.current();
  const view =
    snapshot && loaded
      ? getSeriesView(snapshot, id, { dir: loaded.dir, join: services.platform.paths.join })
      : null;

  if (status === 'loading') {
    return <p className="text-sm text-muted-foreground">载入中…</p>;
  }

  if (!view) {
    return (
      <div className="flex flex-col gap-4">
        <nav className="text-sm text-muted-foreground">
          <Link to="/" className="hover:text-accent">
            首页
          </Link>
        </nav>
        <EmptyState
          icon="📚"
          title="找不到这个系列"
          description={`系列 ${id} 可能已被删除或改名。`}
          action={
            <Link to="/articles">
              <Button size="sm">去文章库</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const { series } = view;
  const toUrl = (image: { id: string; file: string }) =>
    loaded ? imageSource(services.platform, loaded.dir, image) : '';

  return (
    <article className="flex flex-col gap-6">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-accent">
          首页
        </Link>
        <span>/</span>
        <Link to="/articles" className="hover:text-accent">
          文章库
        </Link>
      </nav>

      <Panel className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-10 h-56 w-56 rounded-full bg-accent-soft blur-2xl"
        />
        <div className="relative flex flex-col gap-4 sm:flex-row">
          {view.cover ? (
            <img
              src={toUrl(view.cover)}
              alt={view.cover.caption ?? '封面'}
              className="h-56 w-40 shrink-0 self-start rounded-xl border border-border object-cover shadow-sm"
              loading="lazy"
            />
          ) : null}

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-violet-500/10 px-2 py-0.5 font-medium text-violet-700 dark:text-violet-300">
                系列
              </span>
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5',
                  STATUS_STYLE[series.status] ?? 'border-border',
                )}
              >
                {STATUS_LABEL[series.status] ?? series.status}
              </span>
              {snapshot && hasR18PlotTag(snapshot, series.plotTagIds) ? <R18Badge /> : null}
              <span className="ml-auto flex items-center gap-2">
                <FavoriteButton kind="series" id={series.id} />
                <span className="font-mono text-[0.65rem] text-muted-foreground">{series.id}</span>
              </span>
            </div>

            <h1 className="text-2xl font-semibold tracking-tight">{series.title}</h1>
            {series.summary ? (
              <p className="text-sm leading-6 text-muted-foreground">{series.summary}</p>
            ) : null}

            <dl className="grid grid-cols-[4rem_1fr] gap-x-3 gap-y-1.5 text-sm">
              {view.authors.length > 0 ? (
                <>
                  <dt className="text-muted-foreground">作者</dt>
                  <dd>{view.authors.map((person) => person.name).join('、')}</dd>
                </>
              ) : null}
              {view.translators.length > 0 ? (
                <>
                  <dt className="text-muted-foreground">译者</dt>
                  <dd>{view.translators.map((person) => person.name).join('、')}</dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">篇数</dt>
              <dd>{view.articles.length}</dd>
              <dt className="text-muted-foreground">更新</dt>
              <dd>{series.updatedAt.slice(0, 10)}</dd>
              {view.sourceUrl ? (
                <>
                  <dt className="text-muted-foreground">原出处</dt>
                  <dd>
                    <button
                      type="button"
                      onClick={() => {
                        if (view.sourceUrl) void services.platform.opener.openExternal(view.sourceUrl);
                      }}
                      className="break-all text-left text-sm text-accent underline underline-offset-2 hover:opacity-80"
                    >
                      {view.sourceUrl}
                    </button>
                  </dd>
                </>
              ) : null}
            </dl>

            {(view.characterTags.length > 0 || view.plotTags.length > 0) && (
              <div className="flex flex-wrap gap-2">
                {[...view.characterTags, ...view.plotTags].map((tag) => (
                  <Link key={tag.id} to={`/search?q=${encodeURIComponent(tag.name)}`}>
                    <TagChip name={tag.name} category={tag.category} />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </Panel>

      <Panel>
        <SectionHeading title="目录" description={`共 ${view.articles.length} 篇，按系列顺序排列`} />
        {view.articles.length === 0 ? (
          <EmptyState
            className="mt-3"
            icon="📖"
            title="这个系列还没有收录文章"
            description="在编辑器里把文章勾选进这个系列即可。"
          />
        ) : (
          <ol className="mt-3 flex flex-col divide-y divide-border">
            {view.articles.map((article, index) => (
              <li key={article.id} className="flex flex-col gap-1 py-3">
                <Link
                  to={`/article/${article.id}`}
                  className="group flex items-baseline gap-3 text-sm"
                >
                  <span className="w-7 shrink-0 text-right font-mono text-xs text-accent">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="truncate font-medium group-hover:text-accent">{article.title}</span>
                  {snapshot && hasR18PlotTag(snapshot, article.plotTagIds) ? <R18Badge /> : null}
                  {article.summary ? (
                    <span className="ml-2 hidden truncate text-xs text-muted-foreground sm:inline">
                      {article.summary}
                    </span>
                  ) : null}
                </Link>
                <TagLinks
                  tags={snapshot ? resolveTags(snapshot, [...article.characterTagIds, ...article.plotTagIds]) : []}
                  limit={4}
                  className="pl-10"
                />
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </article>
  );
}
