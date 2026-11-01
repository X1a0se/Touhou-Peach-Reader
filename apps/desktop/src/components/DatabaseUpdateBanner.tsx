import type { UpdateCheck } from '@tpr/core';
import { Button } from '@tpr/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useServices } from '../context.js';
import { useLibraryContext } from '../library/LibraryProvider.js';
import { useSettingsContext } from '../settings/SettingsProvider.js';

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const AUTO_CHECK_DELAY_MS = 1500;

function downloadSource(update: UpdateCheck): string {
  // 优先用检查结果里的资产直链，避免下载前再请求一次 API（也避开 API 限额）。
  if (update.assetUrl !== null) return update.assetUrl;
  // 没有资产直链时退回 release/tag 地址；中文标签需要转义，url.ts 会解码。
  return `https://github.com/${update.owner}/${update.repo}/releases/tag/${encodeURIComponent(update.tag)}`;
}

/**
 * 启动后自动检查数据库更新，并在页面顶部提示。
 *
 * 只自动检查一次（StrictMode 下用 ref + 清理定时器去重）；检查失败静默，
 * 不打断阅读。开启「自动导入」时会直接下载并覆盖当前库。
 */
export function DatabaseUpdateBanner() {
  const services = useServices();
  const library = useLibraryContext();
  const { settings, ready } = useSettingsContext();
  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const checked = useRef(false);

  const source = settings.defaultSource.trim();
  const current = library.snapshot;

  const applyUpdate = useCallback(
    async (candidate: UpdateCheck): Promise<void> => {
      if (updating) return;
      setUpdating(true);
      setError(null);
      setProgress('正在下载…');
      try {
        const result = await services.github.download(downloadSource(candidate), {
          onProgress: (received, total) => {
            const mb = (received / 1024 / 1024).toFixed(1);
            setProgress(
              total
                ? `正在下载 ${mb} / ${(total / 1024 / 1024).toFixed(1)} MB…`
                : `正在下载 ${mb} MB…`,
            );
          },
        });
        setProgress('正在导入…');
        const outcome = await library.importBytes(result.bytes);
        if (!outcome.ok) {
          setError(outcome.error);
          return;
        }
        setNotice(`数据库已更新到 ${candidate.latest}（${result.fileName}）`);
        setUpdate(null);
      } catch (cause) {
        setError(describe(cause));
      } finally {
        setUpdating(false);
        setProgress(null);
      }
    },
    [library, services, updating],
  );

  useEffect(() => {
    if (checked.current) return;
    if (!ready || !settings.autoCheckDatabaseUpdate) return;
    if (source.length === 0) return;
    if (library.status !== 'ready' || current === null || library.busy) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled || checked.current) return;
      checked.current = true;
      void (async () => {
        try {
          const result = await services.github.checkUpdate(source, current.manifest.version, {
            localUpdatedAt: current.manifest.updatedAt,
          });
          if (cancelled) return;
          if (result.upToDate || result.assetName === null) return;
          setUpdate(result);
          if (settings.autoImportDatabaseUpdate) {
            await applyUpdate(result);
          }
        } catch (cause) {
          // 自动检查失败不打断启动；设置页仍可手动检查。
          console.warn('[database-update] 自动检查失败', cause);
        }
      })();
    }, AUTO_CHECK_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    ready,
    settings.autoCheckDatabaseUpdate,
    settings.autoImportDatabaseUpdate,
    source,
    current,
    library.status,
    library.busy,
    services,
    applyUpdate,
  ]);

  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (notice !== null) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
        <span>{notice}</span>
        <Button size="sm" variant="ghost" onClick={() => setNotice(null)}>
          关闭
        </Button>
      </div>
    );
  }

  if (update === null || dismissed || update.upToDate || update.assetName === null) return null;

  return (
    <div className="grid gap-3 rounded-xl border border-accent/40 bg-accent-soft px-4 py-3 text-sm shadow-sm">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-medium">数据库有更新</span>
        <span className="font-mono text-xs text-muted-foreground">
          {update.current ?? '未导入'} → {update.latest}
        </span>
        <span className="break-all font-mono text-xs text-muted-foreground">{update.assetName}</span>
      </div>
      {progress !== null ? <p className="text-xs text-muted-foreground">{progress}</p> : null}
      {error !== null ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={updating || library.busy}
          onClick={() => void applyUpdate(update)}
        >
          {updating ? '更新中…' : error === null ? '立即更新' : '重试更新'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={updating}
          onClick={() => {
            setDismissed(true);
            setError(null);
            setProgress(null);
          }}
        >
          稍后
        </Button>
      </div>
    </div>
  );
}
