import type { CollectionKey, Decision, MergePreview } from '@tpr/core';
import { Button, EmptyState, Panel, SectionHeading, StatTile } from '@tpr/ui';
import { useState } from 'react';
import { useServices } from '../context.js';
import { useLibraryContext } from '../library/LibraryProvider.js';
import { pickTprFile } from '../platform/files.js';

const COLLECTIONS: { key: CollectionKey; label: string }[] = [
  { key: 'authors', label: '作者' },
  { key: 'tags', label: '标签' },
  { key: 'articles', label: '文章' },
  { key: 'series', label: '系列' },
  { key: 'images', label: '图片' },
];

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function MergePage() {
  const services = useServices();
  const library = useLibraryContext();
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const choose = async () => {
    setError(null);
    setMessage(null);
    const path = await pickTprFile();
    if (!path) return;
    setBusy(true);
    try {
      if (preview) await services.merge.discard(preview);
      const next = await services.merge.prepare(path);
      setPreview(next);
      setDecisions({});
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (preview) await services.merge.discard(preview);
    setPreview(null);
    setDecisions({});
  };

  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await services.merge.apply(preview, decisions);
      await library.refresh();
      const taken = globalThis.Object.values(decisions).filter((value) => value === 'take-incoming').length;
      setMessage(
        `已合并「${preview.result.report.incoming.name}」：新增 ${outcome.report.added.articles} 篇、` +
          `更新 ${outcome.report.updated.articles} 篇、保留 ${outcome.report.kept.articles} 篇` +
          (taken > 0 ? `，${taken} 处冲突按你的选择保留对方版本` : ''),
      );
      setPreview(null);
      setDecisions({});
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setBusy(false);
    }
  };

  const report = preview?.result.report ?? null;

  return (
    <div className="flex flex-col gap-5">
      <SectionHeading
        eyebrow="数据"
        title="合并数据库"
        description="选一个 .tpr 与当前库按 id 归并：时间戳较新的版本胜出，同一时刻内容不同才需要你裁决。合并只改本地库，不会动对方的包。"
      />

      {error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => void choose()} disabled={busy}>
          {preview ? '换一个文件' : '选择要合并的 .tpr'}
        </Button>
        {preview ? (
          <>
            <Button onClick={() => void apply()} disabled={busy}>
              应用合并
            </Button>
            <Button variant="ghost" onClick={() => void cancel()} disabled={busy}>
              取消
            </Button>
          </>
        ) : null}
      </div>

      {!preview ? (
        <EmptyState
          icon="⇄"
          title="还没有选择文件"
          description="合并前会先给你一份预览，确认后才写盘。"
        />
      ) : (
        <>
          <Panel>
            <h3 className="text-sm font-medium">
              预览：{report?.base.name} ← {report?.incoming.name}
            </h3>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <StatTile label="数据库" value={report?.incoming.databaseId ?? ''} />
              <StatTile label="版本" value={report?.incoming.version ?? ''} />
              <StatTile label="冲突" value={String(report?.conflicts.length ?? 0)} />
              <StatTile label="疑似重复" value={String(report?.possibleDuplicates.length ?? 0)} />
            </div>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 font-medium">集合</th>
                  <th className="py-1 text-right font-medium">新增</th>
                  <th className="py-1 text-right font-medium">更新</th>
                  <th className="py-1 text-right font-medium">保留</th>
                </tr>
              </thead>
              <tbody>
                {COLLECTIONS.map(({ key, label }) => (
                  <tr key={key} className="border-t border-border/60">
                    <td className="py-1">{label}</td>
                    <td className="py-1 text-right text-emerald-600 dark:text-emerald-400">
                      {report?.added[key] ?? 0}
                    </td>
                    <td className="py-1 text-right text-sky-600 dark:text-sky-400">
                      {report?.updated[key] ?? 0}
                    </td>
                    <td className="py-1 text-right text-muted-foreground">{report?.kept[key] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel>
            <h3 className="text-sm font-medium">冲突（{report?.conflicts.length ?? 0}）</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              默认保留本地版本；选择“用对方”才会把对方的实体与正文写进来。
            </p>
            {report && report.conflicts.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-2">
                {report.conflicts.map((conflict) => (
                  <li
                    key={conflict.conflictId}
                    className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {conflict.collection} · {conflict.baseLabel}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        字段：{conflict.fields.join('、') || '—'}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-4 text-xs">
                      <label className="flex items-center gap-1.5">
                        <input
                          type="radio"
                          name={conflict.conflictId}
                          checked={(decisions[conflict.conflictId] ?? 'keep-base') === 'keep-base'}
                          onChange={() =>
                            setDecisions((prev) => ({ ...prev, [conflict.conflictId]: 'keep-base' }))
                          }
                        />
                        保留本地（{conflict.baseLabel}）
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input
                          type="radio"
                          name={conflict.conflictId}
                          checked={decisions[conflict.conflictId] === 'take-incoming'}
                          onChange={() =>
                            setDecisions((prev) => ({ ...prev, [conflict.conflictId]: 'take-incoming' }))
                          }
                        />
                        用对方（{conflict.incomingLabel}）
                      </label>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">没有冲突，按时间戳合并即可。</p>
            )}
          </Panel>

          <section className="grid gap-4 md:grid-cols-2">
            <Panel>
              <h3 className="text-sm font-medium">疑似重复（{report?.possibleDuplicates.length ?? 0}）</h3>
              {report && report.possibleDuplicates.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {report.possibleDuplicates.map((item) => (
                    <li key={`${item.collection}-${item.normalizedName}`}>
                      {item.collection === 'authors' ? '作者' : '标签'}「{item.normalizedName}」：
                      {item.ids.join('、')}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">没有按名称撞车的实体。</p>
              )}
            </Panel>
            <Panel>
              <h3 className="text-sm font-medium">悬空引用（{report?.dangling.length ?? 0}）</h3>
              {report && report.dangling.length > 0 ? (
                <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-auto text-sm">
                  {report.dangling.map((issue, index) => (
                    <li key={`${issue.code}-${issue.entityId ?? ''}-${index}`}>{issue.message}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">所有引用都能解析。</p>
              )}
            </Panel>
          </section>
        </>
      )}
    </div>
  );
}
