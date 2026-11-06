import {
  type ArticleNeighbors,
  countWords,
  formatWordCount,
  getArticleNeighbors,
  getArticleView,
  hasR18PlotTag,
  type ImageRef,
} from '@tpr/core';
import { Markdown, Panel, R18Badge, TagChip } from '@tpr/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FavoriteButton } from '../components/FavoriteButton.js';
import { Link, useParams } from 'react-router';
import { useBlocklist } from '../blocklist/BlocklistProvider.js';
import { useServices } from '../context.js';
import { useLibraryContext } from '../library/LibraryProvider.js';
import { imageSource } from '../lib/images.js';
import { useReading } from '../reading/ReadingProvider.js';
import { useSettingsContext } from '../settings/SettingsProvider.js';

/** 当前阅读进度：0 表示页首（或页面短到无需滚动），1 表示页尾。 */
function readingProgress(): number {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, window.scrollY / max));
}

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
  const { settings } = useSettingsContext();
  const blocklist = useBlocklist();
  const {
    ready: readingReady,
    visit: visitReading,
    recordProgress,
    toggleBookmark,
    flush: flushReading,
    article: readingArticle,
  } = useReading();

  const [body, setBody] = useState<string | null>(null);
  const [bodyFor, setBodyFor] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const restoredFor = useRef<string | null>(null);
  const wordCount = useMemo(() => (body === null ? null : countWords(body)), [body]);

  const loaded = services.library.current();
  const view = snapshot && loaded ? getArticleView(snapshot, id, { dir: loaded.dir, join: services.platform.paths.join }) : null;
  const hasView = view !== null;
  const seriesId = view?.series?.id ?? null;
  const seriesIndex = view?.series?.index ?? null;
  const saved = readingArticle(id);
  const bookmarked = saved?.bookmark !== null && saved?.bookmark !== undefined;

  useEffect(() => {
    if (!hasView) return;
    let cancelled = false;
    setBody(null);
    setBodyFor(null);
    setBodyError(null);
    services.library
      .readContent(id)
      .then((text) => {
        if (cancelled) return;
        setBody(text);
        setBodyFor(id);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setBodyError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [hasView, id, services]);

  // 进入文章即记一次阅读：刷新足迹、系列进度，同时保留之前记录的滚动位置
  useEffect(() => {
    if (!hasView || !readingReady) return;
    restoredFor.current = null;
    visitReading({ articleId: id, seriesId, seriesIndex });
  }, [hasView, readingReady, id, seriesId, seriesIndex, visitReading]);

  // 正文渲染完成后恢复书签（优先）或上次阅读位置；两者都没有则回到页首
  useEffect(() => {
    if (!hasView || !readingReady || bodyFor !== id) return;
    if (restoredFor.current === id) return;
    restoredFor.current = id;
    const mark = readingArticle(id);
    // 书签记的是精确像素位置；「上次读到」按比例还原，换字号/行距后仍然准确。
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const scrollY =
      mark?.bookmark?.scrollY ??
      (mark !== null && maxScroll > 0 ? Math.round(mark.progress * maxScroll) : (mark?.scrollY ?? 0));
    if (scrollY > 0) {
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
    } else {
      window.scrollTo(0, 0);
    }
  }, [hasView, readingReady, bodyFor, id, readingArticle]);

  // 滚动时节流记录位置；离开页面/关闭窗口时立即落盘
  useEffect(() => {
    if (!hasView || !readingReady || bodyFor !== id) return;
    let frame = 0;
    let lastY = -1;
    const save = () => {
      frame = 0;
      if (Math.abs(window.scrollY - lastY) < 32) return;
      lastY = window.scrollY;
      recordProgress(id, readingProgress(), window.scrollY);
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(save);
    };
    const onHide = () => {
      recordProgress(id, readingProgress(), window.scrollY);
      void flushReading();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', onHide);
      if (frame !== 0) cancelAnimationFrame(frame);
      recordProgress(id, readingProgress(), window.scrollY);
      void flushReading();
    };
  }, [hasView, readingReady, bodyFor, id, recordProgress, flushReading]);

  const toggleReadingBookmark = async (): Promise<void> => {
    setActionError(null);
    try {
      await toggleBookmark(id, readingProgress(), window.scrollY);
    } catch (cause: unknown) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const toggleTagBlock = async (tagId: string, tagName: string): Promise<void> => {
    setActionError(null);
    try {
      await blocklist.toggle({ id: tagId, name: tagName });
    } catch (cause: unknown) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    }
  };

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
                {snapshot && hasR18PlotTag(snapshot, article.plotTagIds) ? <R18Badge /> : null}
                <span className="ml-auto flex items-center gap-2">
                  {settings.showArticleEditorLink ? (
                    <Link
                      to={`/editor?edit=${encodeURIComponent(article.id)}`}
                      className="rounded-md border border-border px-2 py-0.5 text-[0.7rem] text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
                    >
                      编辑
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    aria-pressed={bookmarked}
                    aria-label={bookmarked ? '移除书签' : '加入书签'}
                    onClick={() => {
                      void toggleReadingBookmark();
                    }}
                    className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                      bookmarked
                        ? 'border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200'
                        : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                    }`}
                  >
                    <span aria-hidden="true">🔖</span>
                    {bookmarked ? '已加书签' : '书签'}
                  </button>
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
              {saved && saved.progress > 0.01 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  上次读到 {Math.round(saved.progress * 100)}%
                  {bookmarked ? ' · 已加书签' : ''}
                </p>
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

                <dt className="text-muted-foreground">字数</dt>
                <dd className="text-foreground">
                  {bodyError !== null
                    ? '—'
                    : wordCount === null
                      ? '载入中…'
                      : `${formatWordCount(wordCount)} 字`}
                </dd>

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
              {[...view.characterTags, ...view.plotTags].map((tag) => {
                const blocked = blocklist.has(tag.id);
                return (
                  <span key={tag.id} className="inline-flex items-center gap-1">
                    <Link to={`/search?q=${encodeURIComponent(tag.name)}`}>
                      <TagChip name={tag.name} category={tag.category} />
                    </Link>
                    <button
                      type="button"
                      aria-pressed={blocked}
                      aria-label={blocked ? `取消拉黑标签 ${tag.name}` : `拉黑标签 ${tag.name}`}
                      title={blocked ? '取消拉黑此标签' : '拉黑此标签：搜索结果会排除它'}
                      onClick={() => {
                        void toggleTagBlock(tag.id, tag.name);
                      }}
                      className={`rounded-full border px-1.5 py-0.5 text-[0.65rem] transition-colors ${
                        blocked
                          ? 'border-red-300 bg-red-500/10 text-red-600 dark:border-red-900 dark:text-red-300'
                          : 'border-border text-muted-foreground hover:border-red-300 hover:text-red-600 dark:hover:text-red-300'
                      }`}
                    >
                      {blocked ? '已拉黑' : '拉黑'}
                    </button>
                  </span>
                );
              })}
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
