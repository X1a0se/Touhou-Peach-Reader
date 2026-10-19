import { getArticleView, type ImageRef } from '@tpr/core';
import { Markdown, cn } from '@tpr/ui';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useServices } from '../context.js';
import { useLibraryContext } from '../library/LibraryProvider.js';

const TYPE_LABEL: Record<string, string> = {
  short: '短篇文',
  'series-entry': '系列文',
};

const STATUS_LABEL: Record<string, string> = {
  ongoing: '连载中',
  completed: '已完结',
};

function CoverImage({
  image,
  className,
  toUrl,
}: {
  image: ImageRef;
  className?: string;
  toUrl: (path: string) => string;
}) {
  return (
    <img
      src={toUrl(image.path)}
      alt={image.caption ?? '封面'}
      className={cn('rounded-lg border border-border object-cover', className)}
      loading="lazy"
    />
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
      <section className="flex flex-col gap-4">
        <nav className="text-sm text-muted-foreground">
          <Link to="/" className="underline underline-offset-2">
            首页
          </Link>
        </nav>
        <p className="rounded-md border border-border px-4 py-6 text-center text-sm text-muted-foreground">
          找不到这篇文章（{id}）。
        </p>
      </section>
    );
  }

  const { article } = view;
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

      {view.series ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm dark:border-violet-900 dark:bg-violet-950">
          <span className="text-violet-800 dark:text-violet-200">所属系列：</span>
          <Link to={`/series/${view.series.id}`} className="font-medium underline underline-offset-2">
            {view.series.title}
          </Link>
          {view.series.index !== null ? (
            <span className="text-xs text-violet-700 dark:text-violet-300">第 {view.series.index} 篇</span>
          ) : null}
          <span className="ml-auto rounded border border-violet-300 px-1.5 py-0.5 text-[10px] text-violet-700 dark:border-violet-800 dark:text-violet-300">
            {STATUS_LABEL[view.series.status] ?? view.series.status}
          </span>
        </div>
      ) : null}

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
            {TYPE_LABEL[article.type] ?? article.type}
          </span>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">{article.id}</span>
        </div>
        <h1 className="text-2xl font-semibold text-foreground">{article.title}</h1>
        {article.summary ? <p className="text-sm leading-6 text-muted-foreground">{article.summary}</p> : null}
        <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">作者</dt>
          <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {view.authors.length === 0 ? <span className="text-muted-foreground">佚名</span> : null}
            {view.authors.map((person) => (
              <span key={person.id} className="inline-flex flex-wrap items-center gap-1">
                <Link to={`/search?q=${encodeURIComponent(person.name)}`} className="underline underline-offset-2">
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
                  className="text-left break-all text-sm text-rose-700 underline underline-offset-2 hover:text-rose-800 dark:text-rose-300"
                >
                  {view.sourceUrl}
                </button>
              </dd>
            </>
          ) : null}
        </dl>
      </header>

      {actionError ? (
        <p className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {actionError}
        </p>
      ) : null}

      {view.cover ? <CoverImage image={view.cover} toUrl={toUrl} className="max-h-96 w-full" /> : null}

      <section className="rounded-lg border border-border px-5 py-4">
        {bodyError ? (
          <p className="text-sm text-red-700 dark:text-red-300">正文文件缺失或无法读取：{bodyError}</p>
        ) : body === null ? (
          <p className="text-sm text-muted-foreground">正文载入中…</p>
        ) : body.trim() === '' ? (
          <p className="text-sm text-muted-foreground">（正文为空）</p>
        ) : (
          <Markdown source={body} onLink={openExternal} />
        )}
      </section>

      {view.illustrations.length > 0 ? (
        <section className="flex flex-col gap-5">
          <h2 className="text-sm font-medium text-muted-foreground">插图</h2>
          {view.illustrations.map((image) => (
            <figure key={image.id} className="flex flex-col gap-2">
              <img
                src={toUrl(image.path)}
                alt={image.caption ?? '插图'}
                className="w-full rounded-lg border border-border"
                loading="lazy"
              />
              {image.caption ? (
                <figcaption className="text-center text-xs text-muted-foreground">{image.caption}</figcaption>
              ) : null}
            </figure>
          ))}
        </section>
      ) : null}

      {view.characterTags.length > 0 || view.plotTags.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">标签</h2>
          <div className="flex flex-wrap gap-2">
            {[...view.characterTags, ...view.plotTags].map((tag) => (
              <Link
                key={tag.id}
                to={`/search?q=${encodeURIComponent(tag.name)}`}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  tag.category === 'character'
                    ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200'
                    : 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
                )}
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
