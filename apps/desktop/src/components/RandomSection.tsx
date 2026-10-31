import {
  type DBSnapshot,
  type TenPullResult,
  hasR18PlotTag,
  randomOne,
  resolveTags,
  tenPull,
} from '@tpr/core';
import { Button, EmptyState, Panel, R18Badge, SectionHeading } from '@tpr/ui';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useServices } from '../context.js';
import { imageSource } from '../lib/images.js';
import { TagLinks } from './TagLinks.js';

export function RandomSection({ snapshot }: { snapshot: DBSnapshot }) {
  const services = useServices();
  const navigate = useNavigate();
  const [result, setResult] = useState<TenPullResult | null>(null);
  const loaded = services.library.current();

  const coverUrl = (imageId: string | undefined): string | null => {
    if (!imageId || !loaded) return null;
    const image = snapshot.maps.images.get(imageId);
    if (!image) return null;
    return imageSource(services.platform, loaded.dir, image);
  };

  const drawOne = () => {
    const article = randomOne(snapshot);
    if (article) navigate(`/article/${article.id}`);
  };

  return (
    <Panel>
      <SectionHeading
        eyebrow="发现"
        title="随便看看"
        description="点「十连抽」从全部文章里抽 10 篇，同一系列最多一篇。"
        actions={
          <>
            <Button onClick={drawOne} disabled={snapshot.articles.length === 0}>
              随机一篇
            </Button>
            <Button
              variant="primary"
              disabled={snapshot.articles.length === 0}
              onClick={() => setResult(tenPull(snapshot))}
            >
              十连抽
            </Button>
          </>
        }
      />

      {snapshot.articles.length === 0 && (
        <EmptyState
          className="mt-4"
          icon="🎲"
          title="这个库还没有文章"
          description="先去导入一篇，或在编辑器里新建。"
        />
      )}

      {result !== null && (
        <div className="mt-4">
          {result.depleted && (
            <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              池子里只有 {result.groupCount} 组，本次抽到 {result.picks.length} 篇。
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {result.picks.map((article) => {
              const cover = coverUrl(article.coverImageId);
              const series = article.seriesId ? snapshot.maps.series.get(article.seriesId) : null;
              return (
                <div
                  key={article.id}
                  className="group flex flex-col gap-1.5 rounded-xl border border-border bg-surface/60 p-2 transition-colors hover:bg-surface-strong"
                >
                  <Link to={`/article/${article.id}`} className="flex flex-col gap-1.5">
                    {cover ? (
                      <img
                        src={cover}
                        alt={article.title}
                        className="aspect-[5/7] w-full rounded-lg object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex aspect-[5/7] w-full items-center justify-center rounded-lg border border-dashed border-border text-[0.65rem] text-muted-foreground">
                        无封面
                      </div>
                    )}
                    <span className="line-clamp-2 text-xs font-medium group-hover:text-accent">
                      {article.title}
                    </span>
                    <span className="flex items-center gap-1.5 truncate text-[0.65rem] text-muted-foreground">
                      {hasR18PlotTag(snapshot, article.plotTagIds) ? <R18Badge /> : null}
                      <span className="truncate">
                        {series ? series.title : article.type === 'short' ? '短篇' : '未归系列'}
                      </span>
                    </span>
                  </Link>
                  <TagLinks
                    tags={resolveTags(snapshot, [...article.characterTagIds, ...article.plotTagIds])}
                    limit={2}
                  />
                </div>
              );
            })}
          </div>
          <Button
            className="mt-3"
            size="sm"
            variant="ghost"
            onClick={() => setResult(tenPull(snapshot))}
          >
            重新抽取
          </Button>
        </div>
      )}
    </Panel>
  );
}
