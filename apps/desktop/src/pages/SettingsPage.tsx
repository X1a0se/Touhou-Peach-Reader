import type { ThemeMode, UpdateCheck } from '@tpr/core';
import { useEffect, useState } from 'react';
import { useServices } from '../context.js';
import { useLibraryContext } from '../library/LibraryProvider.js';
import { useSettingsContext } from '../settings/SettingsProvider.js';

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const THEMES: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

export function SettingsPage() {
  const services = useServices();
  const library = useLibraryContext();
  const { settings, ready, save } = useSettingsContext();

  const [source, setSource] = useState(settings.defaultSource);
  const [mirror, setMirror] = useState(settings.mirrorPrefix);
  const [theme, setTheme] = useState<ThemeMode>(settings.theme);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<UpdateCheck | null>(null);

  // 设置异步载入：读完后把表单填上（只做一次，不覆盖用户输入）
  useEffect(() => {
    if (!ready) return;
    setSource(settings.defaultSource);
    setMirror(settings.mirrorPrefix);
    setTheme(settings.theme);
  }, [ready]);

  const snapshot = library.snapshot;
  const currentVersion = snapshot?.manifest.version ?? null;

  const persist = async (patch: Partial<typeof settings>): Promise<void> => {
    setError(null);
    try {
      await save(patch);
      setStatus('已保存');
    } catch (cause) {
      setError(describe(cause));
    }
  };

  const checkUpdate = async (): Promise<void> => {
    const target = source.trim() || settings.defaultSource;
    if (target.length === 0) {
      setError('先填一个默认数据库源地址');
      return;
    }
    setChecking(true);
    setError(null);
    setUpdate(null);
    try {
      const result = await services.github.checkUpdate(target, currentVersion);
      setUpdate(result);
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setChecking(false);
    }
  };

  const redownload = async (): Promise<void> => {
    const target = source.trim() || settings.defaultSource;
    if (target.length === 0) {
      setError('先填一个默认数据库源地址');
      return;
    }
    setError(null);
    setStatus('正在下载…');
    try {
      const result = await services.github.download(target, {
        onProgress: (received, total) => {
          const mb = (received / 1024 / 1024).toFixed(1);
          setStatus(total ? `正在下载 ${mb} / ${(total / 1024 / 1024).toFixed(1)} MB…` : `正在下载 ${mb} MB…`);
        },
      });
      await library.importBytes(result.bytes);
      setStatus(`已导入 ${result.fileName}（${result.tag}）`);
      setUpdate(null);
    } catch (cause) {
      setStatus(null);
      setError(describe(cause));
    }
  };

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold">设置</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          设置保存在 <span className="font-mono">{services.settings.path}</span>，不进数据库、不随导出带走。
        </p>
      </div>

      {error ? (
        <p className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
          {status}
        </p>
      ) : null}

      <div className="grid gap-5 rounded-lg border border-border p-5">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">默认数据库源</span>
          <input
            aria-label="默认数据库源"
            className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="example/tpr-db 或 release 地址"
            disabled={!ready}
          />
          <span className="text-xs text-muted-foreground">`/import` 会预填这个地址，「检查更新 / 重新下载」也用它。</span>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="font-medium">网络镜像前缀（可选）</span>
          <input
            aria-label="网络镜像前缀"
            className="rounded-md border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus:border-primary"
            value={mirror}
            onChange={(event) => setMirror(event.target.value)}
            placeholder="https://mirror.example/gh/（留空 = 直连）"
            disabled={!ready}
          />
          <span className="text-xs text-muted-foreground">只改下载地址，GitHub API 仍直连。</span>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="font-medium">主题</span>
          <select
            aria-label="主题"
            className="w-40 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            value={theme}
            onChange={(event) => {
              const next = event.target.value as ThemeMode;
              setTheme(next);
              void persist({ theme: next });
            }}
            disabled={!ready}
          >
            {THEMES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            onClick={() => void persist({ defaultSource: source, mirrorPrefix: mirror, theme })}
          >
            保存
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-4 py-2 text-sm"
            disabled={checking}
            onClick={() => void checkUpdate()}
          >
            {checking ? '检查中…' : '检查更新'}
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50"
            disabled={library.busy}
            onClick={() => void redownload()}
          >
            {library.busy ? '导入中…' : '重新下载并导入'}
          </button>
        </div>

        {update ? (
          <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm">
            <p>
              源：<span className="font-mono">{update.owner}/{update.repo}</span>
              {update.assetName ? `（${update.assetName}）` : ''}
            </p>
            <p className="mt-1">
              当前版本：<span className="font-mono">{update.current ?? '未导入数据库'}</span> · 最新版本：
              <span className="font-mono">{update.latest}</span>
            </p>
            <p className="mt-1 font-medium">
              {update.upToDate ? '已是最新版本。' : '有新版本可用，可点「重新下载并导入」。'}
            </p>
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-border p-5 text-sm text-muted-foreground">
        <p>
          当前库：{snapshot ? `${snapshot.manifest.name}（${snapshot.manifest.databaseId}，schema ${snapshot.manifest.schemaVersion}）` : '未打开'}
        </p>
        <p className="mt-1">数据库包版本：{currentVersion ?? '—'}</p>
      </div>
    </section>
  );
}
