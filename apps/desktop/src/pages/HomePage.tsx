import { hasR18PlotTag, resolveTags } from '@tpr/core';
import { Button, DropZone, EmptyState, Panel, R18Badge, SectionHeading, StatTile } from '@tpr/ui';
import { Link } from 'react-router';
import { RandomSection } from '../components/RandomSection.js';
import { TagLinks } from '../components/TagLinks.js';
import { useLibraryContext } from '../library/LibraryProvider.js';
import { readFileBytes } from '../library/useLibrary.js';

const count = (value: number | undefined): string => (value === undefined ? '—' : String(value));

export function HomePage() {
  const library = useLibraryContext();
  const { importBytes, exportAll, pickAndImport, busy, snapshot, status } = library;

  return (
    <div className="flex flex-col gap-6">
      {library.error !== null && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">
          {library.error}
        </p>
      )}
      {library.message !== null && (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {library.message}
        </p>
      )}

      {status === 'loading' && <p className="text-sm text-muted-foreground">正在载入本地数据库…</p>}

      {status === 'empty' && (
        <Panel className="py-4">
          <DropZone
            busy={busy}
            onFiles={(files) => {
              const file = files[0];
              if (file) void readFileBytes(file).then(importBytes);
            }}
            onPick={() => void pickAndImport()}
          />
        </Panel>
      )}

      {status === 'ready' && snapshot && (
        <>
          <Panel className="relative overflow-hidden p-6">
            <div
              aria-hidden
              className="pointer-events-none absolute -top-20 -right-16 h-56 w-56 rounded-full bg-accent-soft blur-2xl"
            />
            <div className="relative flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[0.68rem] font-semibold tracking-[0.2em] text-accent uppercase">
                  当前数据库
                </p>
                <h2 className="mt-1 truncate text-2xl font-semibold tracking-tight">
                  {snapshot.manifest.name}
                </h2>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {snapshot.manifest.databaseId} · v{snapshot.manifest.version} · schema{' '}
                  {snapshot.manifest.schemaVersion}
                </p>
              </div>
              <Button onClick={() => void exportAll()} disabled={busy}>
                导出全库 .tpr
              </Button>
            </div>

            <dl className="relative mt-5 grid grid-cols-3 gap-3 sm:grid-cols-6">
              {(
                [
                  ['文章', snapshot.manifest.counts.articles],
                  ['系列', snapshot.manifest.counts.series],
                  ['作者', snapshot.manifest.counts.authors],
                  ['标签', snapshot.manifest.counts.tags],
                  ['图片', snapshot.manifest.counts.images],
                  ['鸣谢', snapshot.manifest.counts.credits],
                ] as const
              ).map(([label, value]) => (
                <StatTile key={label} label={label} value={count(value)} />
              ))}
            </dl>
          </Panel>

          <RandomSection snapshot={snapshot} />

          <Panel>
            <SectionHeading
              title="最近文章"
              description={`${snapshot.manifest.updatedAt.slice(0, 10)} 更新`}
              actions={
                <Link to="/articles" className="text-xs text-accent hover:underline">
                  全部文章 →
                </Link>
              }
            />
            <ul className="mt-3 flex flex-col divide-y divide-border">
              {snapshot.articles
                .slice()
                .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
                .slice(0, 5)
                .map((article) => (
                  <li key={article.id} className="flex flex-col gap-1 py-2.5">
                    <Link
                      to={`/article/${article.id}`}
                      className="group flex items-center gap-3 text-sm"
                    >
                      <span
                        className={
                          article.type === 'short'
                            ? 'rounded-full bg-emerald-500/10 px-2 py-0.5 text-[0.65rem] font-medium text-emerald-700 dark:text-emerald-300'
                            : 'rounded-full bg-violet-500/10 px-2 py-0.5 text-[0.65rem] font-medium text-violet-700 dark:text-violet-300'
                        }
                      >
                        {article.type === 'short' ? '短篇' : '系列'}
                      </span>
                      {hasR18PlotTag(snapshot, article.plotTagIds) ? <R18Badge /> : null}
                      <span className="truncate group-hover:text-accent">{article.title}</span>
                      <span className="ml-auto shrink-0 font-mono text-[0.65rem] text-muted-foreground">
                        {article.id}
                      </span>
                    </Link>
                    <TagLinks
                      tags={resolveTags(snapshot, [...article.characterTagIds, ...article.plotTagIds])}
                      limit={4}
                      className="pl-1"
                    />
                  </li>
                ))}
            </ul>
          </Panel>

          {library.warnings.length > 0 && (
            <Panel className="border-amber-500/40 bg-amber-500/5">
              <h3 className="text-sm font-medium text-amber-700 dark:text-amber-300">
                导入提示（{library.warnings.length}）
              </h3>
              <ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                {library.warnings.slice(0, 6).map((warning, index) => (
                  <li key={`${warning.code}-${index}`} className="font-mono">
                    {warning.code}: {warning.message}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {snapshot.articles.length === 0 && (
            <EmptyState
              title="这篇数据库还没有文章"
              description="去编辑器新建一篇，或用合并功能把别的包并进来。"
              action={
                <Link to="/editor">
                  <Button size="sm">打开编辑器</Button>
                </Link>
              }
            />
          )}
        </>
      )}

      {status === 'ready' && (
        <p className="text-sm">
          <Link to="/search" className="text-accent hover:underline">
            去搜索 →
          </Link>
        </p>
      )}
    </div>
  );
}
