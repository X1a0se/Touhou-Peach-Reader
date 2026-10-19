import { type DBSnapshot, type TenPullResult, randomOne, resolveTags, tenPull } from '@tpr/core';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useServices } from '../context.js';
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
    return services.platform.assets.toUrl(services.platform.paths.join(loaded.dir, image.file));
  };

  const drawOne = () => {
    const article = randomOne(snapshot);
    if (article) navigate(`/article/${article.id}`);
  };

  return (
    <section className="rounded-lg border border-border p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-medium">随便看看</h3>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={drawOne}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
          >
            随机一篇
          </button>
          <button
            type="button"
            onClick={() => setResult(tenPull(snapshot))}
            className="rounded-md border border-border bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90"
          >
            十连抽
          </button>
        </div>
      </div>

      {snapshot.articles.length === 0 ? (
        <p className="text-sm text-muted-foreground">这个库还没有文章，先去导入或编辑吧。</p>
      ) : null}

      {result ? (
        <>
          {result.depleted ? (
            <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              池子里只有 {result.groupCount} 组，本次抽到 {result.picks.length} 篇。
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {result.picks.map((article) => {
              const cover = coverUrl(article.coverImageId);
              const series = article.seriesId ? snapshot.maps.series.get(article.seriesId) : null;
              return (
                <div
                  key={article.id}
                  className="group flex flex-col gap-1.5 rounded-md border border-border p-2 transition-colors hover:bg-accent/50"
                >
                  <Link to={`/article/${article.id}`} className="flex flex-col gap-1.5">
                    {cover ? (
                      <img
                        src={cover}
                        alt={article.title}
                        className="aspect-[5/7] w-full rounded object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex aspect-[5/7] w-full items-center justify-center rounded border border-dashed border-border text-[10px] text-muted-foreground">
                        无封面
                      </div>
                    )}
                    <span className="line-clamp-2 text-xs font-medium group-hover:underline">{article.title}</span>
                    <span className="truncate text-[10px] text-muted-foreground">
                      {series ? series.title : article.type === 'short' ? '短篇' : '未归系列'}
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
          <button
            type="button"
            onClick={() => setResult(tenPull(snapshot))}
            className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            重新抽取
          </button>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">点「十连抽」从全部文章里抽 10 篇，同一系列最多一篇。</p>
      )}
    </section>
  );
}
