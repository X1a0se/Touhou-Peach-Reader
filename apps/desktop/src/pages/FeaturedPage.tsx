import { type FeaturedPage as FeaturedPageKind, getFeaturedCards } from '@tpr/core';
import { Link } from 'react-router';
import { useServices } from '../context.js';
import { useLibraryContext } from '../library/LibraryProvider.js';

const TITLE: Record<FeaturedPageKind, string> = {
  short: '精选短文',
  series: '精选系列',
};

const HINT: Record<FeaturedPageKind, string> = {
  short: '推荐语全部来自数据库的 featured.json。',
  series: '推荐语全部来自数据库的 featured.json。',
};

export function FeaturedPage({ page }: { page: FeaturedPageKind }) {
  const services = useServices();
  const { snapshot, status } = useLibraryContext();
  const loaded = services.library.current();
  const cards =
    snapshot && loaded
      ? getFeaturedCards(snapshot, { dir: loaded.dir, join: services.platform.paths.join }, page)
      : [];

  const valid = cards.filter((card) => card.status === 'ok');
  const broken = cards.filter((card) => card.status === 'missing');

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-medium">{TITLE[page]}</h2>
        <p className="text-xs text-muted-foreground">{HINT[page]}</p>
      </header>

      {status === 'loading' ? <p className="text-sm text-muted-foreground">载入中…</p> : null}

      {status === 'ready' && cards.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          这个数据库还没有{TITLE[page]}。
        </p>
      ) : null}

      {valid.map((card) => (
        <article key={card.key} className="overflow-hidden rounded-lg border border-border">
          <Link to={card.to ?? '#'} className="flex gap-4 p-4 hover:bg-accent/40">
            {card.cover ? (
              <img
                src={services.platform.assets.toUrl(card.cover.path)}
                alt={card.cover.caption ?? card.title}
                className="h-28 w-20 shrink-0 rounded-md border border-border object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex h-28 w-20 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-[10px] text-muted-foreground">
                无封面
              </div>
            )}
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {card.kindLabel ? <span>{card.kindLabel}</span> : null}
                <span className="ml-auto font-mono text-[10px]">{card.targetId}</span>
              </div>
              <h3 className="truncate text-base font-medium">{card.title}</h3>
              {card.summary ? <p className="line-clamp-2 text-sm text-muted-foreground">{card.summary}</p> : null}
            </div>
          </Link>

          <div className="border-t border-border bg-muted/30 px-4 py-3">
            <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">
              推荐语{card.recommendations.length > 0 ? `（${card.recommendations.length}）` : ''}
            </h4>
            {card.recommendations.length === 0 ? (
              <p className="text-xs text-muted-foreground">（暂无推荐语）</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {card.recommendations.map((rec, index) => (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: 推荐语没有 id，同文本允许重复
                    key={index}
                    className="text-sm leading-6"
                  >
                    <span className="text-muted-foreground">{rec.author ? `@${rec.author}：` : ''}</span>
                    <span>{rec.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </article>
      ))}

      {broken.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-amber-800 dark:text-amber-200">条目已失效（{broken.length}）</h3>
          {broken.map((card) => (
            <div
              key={card.key}
              className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950"
            >
              <div className="flex items-center gap-2">
                <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                  已失效
                </span>
                <span className="truncate font-medium">{card.title}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-amber-800/70 dark:text-amber-200/70">
                  {card.targetId}
                </span>
              </div>
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">{card.reason}</p>
              {card.recommendations.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1 text-xs text-amber-900/80 dark:text-amber-100/80">
                  {card.recommendations.map((rec, index) => (
                    <li key={index}>
                      {rec.author ? `@${rec.author}：` : ''}
                      {rec.text}
                    </li>
                  ))}
                </ul>
              ) : null}
              {card.to ? (
                <Link to={card.to} className="mt-2 inline-block text-xs underline underline-offset-2">
                  仍然打开这篇文章
                </Link>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
    </section>
  );
}
