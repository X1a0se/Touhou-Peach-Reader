import { type FeaturedPage as FeaturedPageKind, getFeaturedCards } from '@tpr/core';
import { Button, EmptyState, Panel, SectionHeading } from '@tpr/ui';
import { Link } from 'react-router';
import { TagLinks } from '../components/TagLinks.js';
import { useServices } from '../context.js';
import { useLibraryContext } from '../library/LibraryProvider.js';
import { imageSource } from '../lib/images.js';

const TITLE: Record<FeaturedPageKind, string> = {
  short: '精选短文',
  series: '精选系列',
};

export function FeaturedPage({ page }: { page: FeaturedPageKind }) {
  const services = useServices();
  const { snapshot, status } = useLibraryContext();
  const loaded = services.library.current();
  const cards =
    snapshot && loaded
      ? getFeaturedCards(snapshot, { dir: loaded.dir, join: services.platform.paths.join }, page)
      : [];

  const imageUrl = (image: { id: string; file: string }) =>
    loaded ? imageSource(services.platform, loaded.dir, image) : '';
  const valid = cards.filter((card) => card.status === 'ok');
  const broken = cards.filter((card) => card.status === 'missing');

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        eyebrow="推荐"
        title={TITLE[page]}
        description="推荐语全部来自数据库的 featured.json。"
      />

      {status === 'loading' && <p className="text-sm text-muted-foreground">载入中…</p>}

      {status === 'ready' && cards.length === 0 && (
        <EmptyState
          icon="✨"
          title={`这个数据库还没有${TITLE[page]}`}
          description="可以在编辑器「推荐语」页签里添加。"
          action={
            <Link to="/editor">
              <Button size="sm">打开编辑器</Button>
            </Link>
          }
        />
      )}

      {valid.map((card) => (
        <Panel key={card.key} className="overflow-hidden p-0">
          <div className="flex flex-col gap-4 p-4 sm:flex-row">
            <Link to={card.to ?? '#'} className="shrink-0" aria-label={`打开《${card.title}》`}>
              {card.cover ? (
                <img
                  src={imageUrl(card.cover)}
                  alt={card.cover.caption ?? card.title}
                  className="h-36 w-24 rounded-xl border border-border object-cover shadow-sm"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-36 w-24 items-center justify-center rounded-xl border border-dashed border-border text-[0.65rem] text-muted-foreground">
                  无封面
                </div>
              )}
            </Link>
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {card.kindLabel ? <span>{card.kindLabel}</span> : null}
                <span className="ml-auto font-mono text-[0.65rem]">{card.targetId}</span>
              </div>
              <h3 className="truncate text-lg font-semibold">
                <Link to={card.to ?? '#'} className="hover:text-accent">
                  {card.title}
                </Link>
              </h3>
              {card.summary ? (
                <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">{card.summary}</p>
              ) : null}
              <TagLinks tags={card.tags} limit={4} className="pt-0.5" />
            </div>
          </div>

          <div className="border-t border-border bg-surface-strong/60 px-4 py-3">
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
                    className="rounded-lg border-l-2 border-accent/60 bg-background/40 px-3 py-1 text-sm leading-6"
                  >
                    <span className="text-muted-foreground">{rec.author ? `@${rec.author}：` : ''}</span>
                    <span>{rec.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
      ))}

      {broken.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-amber-700 dark:text-amber-300">
            条目已失效（{broken.length}）
          </h3>
          {broken.map((card) => (
            <div
              key={card.key}
              className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[0.65rem] text-amber-800 dark:text-amber-200">
                  已失效
                </span>
                <span className="truncate font-medium">{card.title}</span>
                <span className="ml-auto shrink-0 font-mono text-[0.65rem] text-amber-700/70 dark:text-amber-200/70">
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
                <Link to={card.to} className="mt-2 inline-block text-xs text-accent hover:underline">
                  仍然打开这篇文章
                </Link>
              ) : null}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
