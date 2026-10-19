import { resolveTags } from '@tpr/core';
import { DropZone, cn } from '@tpr/ui';
import { useCallback } from 'react';
import { Link } from 'react-router';
import { RandomSection } from '../components/RandomSection.js';
import { TagLinks } from '../components/TagLinks.js';
import { useLibraryContext } from '../library/LibraryProvider.js';
import { readFileBytes, useNativeDrop } from '../library/useLibrary.js';

const count = (value: number | undefined): string => (value === undefined ? '—' : String(value));

export function HomePage() {
  const library = useLibraryContext();
  const { importBytes, importPath, exportAll, pickAndImport, busy, snapshot, status } = library;

  const handlePaths = useCallback(
    (paths: string[]) => {
      const first = paths[0];
      if (first) void importPath(first);
    },
    [importPath],
  );
  useNativeDrop(handlePaths);

  return (
    <>
      {library.error ? (
        <p className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {library.error}
        </p>
      ) : null}
      {library.message ? (
        <p className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
          {library.message}
        </p>
      ) : null}

      {status === 'loading' ? (
        <p className="text-sm text-muted-foreground">正在载入本地数据库…</p>
      ) : null}

      {status === 'empty' ? (
        <DropZone
          busy={busy}
          onFiles={(files) => {
            const file = files[0];
            if (file) void readFileBytes(file).then(importBytes);
          }}
          onPick={() => void pickAndImport()}
        />
      ) : null}

      {status === 'ready' && snapshot ? (
        <>
          <section className="rounded-lg border border-border p-5">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <div className="flex flex-col">
                <h2 className="text-lg font-medium">{snapshot.manifest.name}</h2>
                <span className="font-mono text-xs text-muted-foreground">
                  {snapshot.manifest.databaseId} · v{snapshot.manifest.version} · schema{' '}
                  {snapshot.manifest.schemaVersion}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void exportAll()}
                disabled={busy}
                className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
              >
                导出全库 .tpr
              </button>
            </div>

            <dl className="grid grid-cols-3 gap-3 sm:grid-cols-6">
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
                <div key={label} className="rounded-md bg-muted/50 px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="text-lg font-medium tabular-nums">{count(value)}</dd>
                </div>
              ))}
            </dl>
          </section>

          <RandomSection snapshot={snapshot} />

          <section className="rounded-lg border border-border p-5">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-sm font-medium">最近文章</h3>
              <div className="flex items-baseline gap-3">
                <span className="text-xs text-muted-foreground">
                  {snapshot.manifest.updatedAt.slice(0, 10)} 更新
                </span>
                <Link to="/articles" className="text-xs underline underline-offset-2 hover:text-foreground">
                  全部文章 →
                </Link>
              </div>
            </div>
            <ul className="flex flex-col divide-y divide-border">
              {snapshot.articles
                .slice()
                .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
                .slice(0, 5)
                .map((article) => (
                  <li key={article.id} className="flex flex-col gap-1 py-2">
                    <Link
                      to={`/article/${article.id}`}
                      className="flex items-center gap-3 rounded-md text-sm hover:bg-accent/60"
                    >
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px]',
                          article.type === 'short'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
                            : 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200',
                        )}
                      >
                        {article.type === 'short' ? '短篇' : '系列'}
                      </span>
                      <span className="truncate">{article.title}</span>
                      <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
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
          </section>

          {library.warnings.length > 0 ? (
            <section className="rounded-lg border border-amber-300 bg-amber-50 p-5 text-sm dark:border-amber-900 dark:bg-amber-950">
              <h3 className="mb-2 font-medium">导入提示（{library.warnings.length}）</h3>
              <ul className="flex flex-col gap-1 text-xs">
                {library.warnings.slice(0, 6).map((warning, index) => (
                  <li key={`${warning.code}-${index}`} className="font-mono">
                    {warning.code}: {warning.message}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}

      {status === 'ready' ? (
        <p className="text-sm">
          <Link to="/search" className="underline underline-offset-2 hover:text-foreground">
            去搜索 →
          </Link>
        </p>
      ) : null}
    </>
  );
}
