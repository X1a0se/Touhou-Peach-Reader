import { type ArticleNeighbors, getArticleNeighbors, getArticleView, type ImageRef } from '@tpr/core';
import { Markdown, Panel, TagChip } from '@tpr/ui';
import { useEffect, useState } from 'react';
import { FavoriteButton } from '../components/FavoriteButton.js';
import { Link, useParams } from 'react-router';
import { useServices } from '../context.js';
import { useLibraryContext } from '../library/LibraryProvider.js';
import { imageSource } from '../lib/images.js';

const TYPE_LABEL: Record<string, string> = {
  short: '短篇文',
  'series-entry': '系列文',
};

const STATUS_LABEL: Record<string, string> = {
  ongoing: '连载中',
  completed: '已完结',
};

function CoverImage({ image, toUrl }: { image: ImageRef; toUrl: (image: ImageRef) => string }) {
  return (
    <img
      src={toUrl(image)}
      alt={image.caption ?? '封面'}
      className="h-52 w-[9.5rem] shrink-0 rounded-lg border border-border object-cover shadow-sm"
      loading="lazy"
    />
  );
}

function SeriesPager({
  neighbors,
  where,
}: {
  neighbors: ArticleNeighbors;
  where: 'top' | 'bottom';
}) {
  const { series, previous, next } = neighbors;
  if (!previous && !next) return null;

  return (
    <nav
      aria-label={where === 'top' ? '系列文章导航（文首）' : '系列文章导航（文尾）'}
      className="flex flex-col gap-2 rounded-xl border border-border bg-surface/60 p-2 text-sm shadow-sm backdrop-blur-sm"
    >
      <div className="flex items-stretch gap-2">
        {previous ? (
          <Link
            to={`/article/${previous.id}`}
            aria-label={`上一篇：${previous.title}`}
            className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-lg px-3 py-2 transition-colors hover:bg-surface-strong"
          >
            <span className="text-[0.68rem] text-muted-foreground">← 上一篇</span>
            <span className="truncate font-medium">{previous.title}</span>
          </Link>
        ) : (
          <span className="flex min-w-0 flex-1 items-center px-3 py-2 text-xs text-muted-foreground">
            已是第一篇
          </span>
        )}
        {next ? (
          <Link
            to={`/article/${next.id}`}
            aria-label={`下一篇：${next.title}`}
            className="flex min-w-0 flex-1 flex-col items-end gap-0.5 rounded-lg px-3 py-2 text-right transition-colors hover:bg-surface-strong"
          >
            <span className="text-[0.68rem] text-muted-foreground">下一篇 →</span>
            <span className="truncate font-medium">{next.title}</span>
          </Link>
        ) : (
          <span className="flex min-w-0 flex-1 items-center justify-end px-3 py-2 text-xs text-muted-foreground">
            已是最后一篇
          </span>
        )}
      </div>
      <Link
        to={`/series/${series.id}`}
        className="border-t border-border px-3 pt-2 text-center text-xs text-muted-foreground transition-colors hover:text-accent"
      >
        返回《{series.title}》目录
      </Link>
    </nav>
  );
}

export function ArticlePage() {
  const { id = '' } = useParams();
  const services = useServices();
  const { snapshot, status } = useLibraryContext();

  const [body, setBody] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loaded = services.library.current();
  const view = snapshot && loaded ? getArticleView(snapshot, id, { dir: loaded.dir, join: services.platform.paths.join }) : null;
  const hasView = view !== null;

  useEffect(() => {
    if (!hasView) return;
    let cancelled = false;
    setBody(null);
    setBodyError(null);
    services.library
      .readContent(id)
      .then((text) => {
        if (!cancelled) setBody(text);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setBodyError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [hasView, id, services]);

  const openExternal = (url: string) => {
    setActionError(null);
    void services.platform.opener.openExternal(url).catch((cause: unknown) => {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    });
  };

  if (status === 'loading') {
    return <p className="text-sm text-muted-foreground">载入中…</p>;
  }

  if (!view) {
    return (
      <div className="flex flex-col gap-4">
        <nav className="text-sm text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            首页
          </Link>
        </nav>
        <Panel className="py-10 text-center text-sm text-muted-foreground">
          找不到这篇文章（{id}）。
        </Panel>
      </div>
    );
  }

  const { article } = view;
  const neighbors = snapshot ? getArticleNeighbors(snapshot, article.id) : null;
  const toUrl = (image: ImageRef) =>
    loaded ? imageSource(services.platform, loaded.dir, image) : '';

  return (
    <div>
      <article className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            首页
          </Link>
          <span>/</span>
          <Link to="/articles" className="hover:text-foreground">
            文章库
          </Link>
        </nav>

        {view.series ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-accent-soft px-4 py-2.5 text-sm">
            <span className="text-muted-foreground">所属系列：</span>
            <Link to={`/series/${view.series.id}`} className="font-medium underline underline-offset-2">
              {view.series.title}
            </Link>
            {view.series.index !== null ? (
              <span className="text-xs text-muted-foreground">第 {view.series.index} 篇</span>
            ) : null}
            <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-[0.65rem] text-muted-foreground">
              {STATUS_LABEL[view.series.status] ?? view.series.status}
            </span>
          </div>
        ) : null}

        <Panel className="p-6">
          <div className="flex flex-wrap items-start gap-5">
            {view.cover ? <CoverImage image={view.cover} toUrl={toUrl} /> : null}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-300">
                  {TYPE_LABEL[article.type] ?? article.type}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  <FavoriteButton kind="article" id={article.id} />
                  <span className="font-mono text-[0.65rem] text-muted-foreground">{article.id}</span>
                </span>
              </div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                {article.title}
              </h1>
              {article.summary ? (
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{article.summary}</p>
              ) : null}
              <dl className="mt-4 grid grid-cols-[4rem_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">作者</dt>
                <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {view.authors.length === 0 ? <span className="text-muted-foreground">佚名</span> : null}
                  {view.authors.map((person) => (
                    <span key={person.id} className="inline-flex flex-wrap items-center gap-1">
                      <Link to={`/search?q=${encodeURIComponent(person.name)}`} className="hover:text-accent">
                        {person.name}
                      </Link>
                      {person.aliases.length > 0 ? (
                        <details className="inline-block">
                          <summary className="cursor-pointer list-none text-xs text-muted-foreground hover:text-foreground">
                            ({person.aliases.length} 个别名)
                          </summary>
                          <span className="ml-1 text-xs text-muted-foreground">{person.aliases.join('、')}</span>
                        </details>
                      ) : null}
                    </span>
                  ))}
                </dd>

                {view.translators.length > 0 ? (
                  <>
                    <dt className="text-muted-foreground">译者</dt>
                    <dd className="text-foreground">{view.translators.map((person) => person.name).join('、')}</dd>
                  </>
                ) : null}

                <dt className="text-muted-foreground">更新</dt>
                <dd className="text-foreground">{article.updatedAt.slice(0, 10)}</dd>

                {view.sourceUrl ? (
                  <>
                    <dt className="text-muted-foreground">原出处</dt>
                    <dd>
                      <button
                        type="button"
                        onClick={() => view.sourceUrl && openExternal(view.sourceUrl)}
                        className="text-left break-all text-sm text-accent underline underline-offset-2 hover:opacity-80"
                      >
                        {view.sourceUrl}
                      </button>
                    </dd>
                  </>
                ) : null}
              </dl>
            </div>
          </div>
        </Panel>

        {actionError !== null && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-600 dark:text-red-300">
            {actionError}
          </p>
        )}

        {view.characterTags.length > 0 || view.plotTags.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">标签</h2>
            <div className="flex flex-wrap gap-2">
              {[...view.characterTags, ...view.plotTags].map((tag) => (
                <Link key={tag.id} to={`/search?q=${encodeURIComponent(tag.name)}`}>
                  <TagChip name={tag.name} category={tag.category} />
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {neighbors ? <SeriesPager neighbors={neighbors} where="top" /> : null}

        <Panel className="p-6">
          {bodyError ? (
            <p className="text-sm text-red-600 dark:text-red-300">正文文件缺失或无法读取：{bodyError}</p>
          ) : body === null ? (
            <p className="text-sm text-muted-foreground">正文载入中…</p>
          ) : body.trim() === '' ? (
            <p className="text-sm text-muted-foreground">（正文为空）</p>
          ) : (
            <div className="reading">
              <Markdown source={body} onLink={openExternal} />
            </div>
          )}
        </Panel>

        {view.illustrations.length > 0 ? (
          <section className="flex flex-col gap-5">
            <h2 className="text-sm font-medium text-muted-foreground">插图</h2>
            {view.illustrations.map((image) => (
              <figure key={image.id} className="flex flex-col gap-2">
                <img
                  src={toUrl(image)}
                  alt={image.caption ?? '插图'}
                  className="w-full rounded-xl border border-border"
                  loading="lazy"
                />
                {image.caption ? (
                  <figcaption className="text-center text-xs text-muted-foreground">{image.caption}</figcaption>
                ) : null}
              </figure>
            ))}
          </section>
        ) : null}

        {neighbors ? <SeriesPager neighbors={neighbors} where="bottom" /> : null}
      </article>
    </div>
  );
}
