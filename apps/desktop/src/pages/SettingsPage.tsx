import type {
  PaletteId,
  SettingsPatch,
  ThemeMode,
  UpdateCheck,
  WallpaperSettings,
} from '@tpr/core';
import { Button, Panel, SectionHeading } from '@tpr/ui';
import { useEffect, useState } from 'react';
import { useServices } from '../context.js';
import { useLibraryContext } from '../library/LibraryProvider.js';
import { getAppRuntimeInfo, hasTauriInvoke, type AppRuntimeInfo } from '../platform/app-info.js';
import { pickWallpaperFile } from '../platform/files.js';
import { useSettingsContext } from '../settings/SettingsProvider.js';

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const THEMES: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

const PALETTES: { id: PaletteId; label: string; hint: string; swatch: string }[] = [
  {
    id: 'peach',
    label: '桃夭',
    hint: '桃色主调',
    swatch: 'linear-gradient(135deg, oklch(0.9 0.07 20), oklch(0.72 0.14 8))',
  },
  {
    id: 'bamboo',
    label: '竹青',
    hint: '青绿主调',
    swatch: 'linear-gradient(135deg, oklch(0.9 0.06 150), oklch(0.64 0.1 158))',
  },
  {
    id: 'moon',
    label: '月白',
    hint: '月蓝主调',
    swatch: 'linear-gradient(135deg, oklch(0.92 0.04 250), oklch(0.66 0.08 245))',
  },
  {
    id: 'scarlet',
    label: '绯红',
    hint: '朱红主调',
    swatch: 'linear-gradient(135deg, oklch(0.9 0.08 40), oklch(0.62 0.19 28))',
  },
  {
    id: 'ink',
    label: '墨染',
    hint: '水墨灰阶',
    swatch: 'linear-gradient(135deg, oklch(0.92 0.004 260), oklch(0.42 0.02 265))',
  },
];

const inputClass =
  'rounded-lg border border-border bg-background/70 px-3 py-2 font-mono text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-[var(--ring)]';

interface WallpaperSlotProps {
  slot: 'home' | 'article';
  label: string;
  hint: string;
}

function WallpaperSlot({ slot, label, hint }: WallpaperSlotProps) {
  const services = useServices();
  const { settings, ready, save } = useSettingsContext();
  const wallpaper = settings.wallpapers[slot];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(wallpaper.opacity);
  const [blur, setBlur] = useState(wallpaper.blur);

  useEffect(() => {
    setOpacity(wallpaper.opacity);
    setBlur(wallpaper.blur);
  }, [wallpaper.opacity, wallpaper.blur]);

  const url = wallpaper.file === '' ? '' : services.platform.wallpapers.toUrl(wallpaper.file);

  const commit = async (patch: Partial<WallpaperSettings>): Promise<void> => {
    setError(null);
    try {
      await save({ wallpapers: { [slot]: patch } });
    } catch (cause) {
      setError(describe(cause));
    }
  };

  const choose = async (): Promise<void> => {
    setError(null);
    const picked = await pickWallpaperFile();
    if (picked === null) return;
    setBusy(true);
    try {
      const { fileName } = await services.platform.wallpapers.importFile(picked);
      if (wallpaper.file !== '' && wallpaper.file !== fileName) {
        await services.platform.wallpapers.remove(wallpaper.file);
      }
      await commit({ file: fileName });
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setBusy(false);
    }
  };

  const clear = async (): Promise<void> => {
    setBusy(true);
    try {
      await services.platform.wallpapers.remove(wallpaper.file);
      await commit({ file: '' });
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3 rounded-xl border border-border bg-surface/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">
            {label}
            <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[0.68rem] font-normal text-muted-foreground">
              {wallpaper.file === '' ? '未设置' : wallpaper.file}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={!ready || busy} onClick={() => void choose()}>
            {busy ? '处理中…' : wallpaper.file === '' ? '选择图片' : '更换图片'}
          </Button>
          {wallpaper.file !== '' && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void clear()}>
              移除
            </Button>
          )}
        </div>
      </div>

      {url !== '' ? (
        <div
          className="h-28 w-full rounded-lg border border-border bg-cover bg-center"
          style={{ backgroundImage: `url("${url}")` }}
          data-testid={`wallpaper-preview-${slot}`}
        />
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          PNG / JPEG / WebP，最大 20 MB。图片会复制进应用数据目录。
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-muted-foreground">
          <span>
            不透明度 <span className="font-mono text-foreground">{Math.round(opacity * 100)}%</span>
          </span>
          <input
            aria-label={`${label}：不透明度`}
            type="range"
            min={10}
            max={100}
            step={5}
            value={Math.round(opacity * 100)}
            disabled={wallpaper.file === ''}
            onChange={(event) => setOpacity(Number(event.target.value) / 100)}
            onPointerUp={() => void commit({ opacity })}
            onKeyUp={() => void commit({ opacity })}
            className="accent-[var(--accent)]"
          />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          <span>
            模糊 <span className="font-mono text-foreground">{blur}px</span>
          </span>
          <input
            aria-label={`${label}：模糊`}
            type="range"
            min={0}
            max={20}
            step={1}
            value={blur}
            disabled={wallpaper.file === ''}
            onChange={(event) => setBlur(Number(event.target.value))}
            onPointerUp={() => void commit({ blur })}
            onKeyUp={() => void commit({ blur })}
            className="accent-[var(--accent)]"
          />
        </label>
      </div>

      {error !== null && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function SettingsPage() {
  const services = useServices();
  const library = useLibraryContext();
  const { settings, ready, save } = useSettingsContext();

  const [source, setSource] = useState(settings.defaultSource);
  const [mirror, setMirror] = useState(settings.mirrorPrefix);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  const [runtime, setRuntime] = useState<AppRuntimeInfo | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = (): void => {
      void getAppRuntimeInfo().then((info) => {
        if (!alive) return;
        setRuntimeLoading(false);
        if (info) setRuntime(info);
      });
    };
    load();
    // 首次挂载可能早于 Tauri IPC 就绪，补一次重试（读到就停）。
    const timer = setTimeout(load, 1500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    setSource(settings.defaultSource);
    setMirror(settings.mirrorPrefix);
  }, [ready]);

  const snapshot = library.snapshot;
  const currentVersion = snapshot?.manifest.version ?? null;

  const persist = async (patch: SettingsPatch): Promise<void> => {
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
          setStatus(
            total ? `正在下载 ${mb} / ${(total / 1024 / 1024).toFixed(1)} MB…` : `正在下载 ${mb} MB…`,
          );
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
    <div className="flex flex-col gap-6">
      <SectionHeading
        eyebrow="偏好"
        title="设置"
        description={`保存在 ${services.settings.path}；不进数据库、不随导出带走。`}
      />

      {error !== null && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">{error}</p>}
      {status !== null && <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">{status}</p>}

      <Panel className="grid gap-4">
        <SectionHeading title="外观" description="配色跟随全局，明暗可与系统同步。" />
        <div className="grid gap-2">
          <span className="text-sm font-medium">配色</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label="配色">
            {PALETTES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-label={`配色：${item.label}`}
                aria-pressed={settings.palette === item.id}
                disabled={!ready}
                onClick={() => void persist({ palette: item.id })}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  settings.palette === item.id
                    ? 'border-accent bg-accent-soft text-foreground'
                    : 'border-border bg-surface/60 text-muted-foreground hover:bg-surface-strong'
                }`}
              >
                <span
                  aria-hidden
                  className="h-5 w-5 rounded-full border border-black/10 shadow-inner"
                  style={{ backgroundImage: item.swatch }}
                />
                <span className="font-medium text-foreground">{item.label}</span>
                <span className="text-xs text-muted-foreground">{item.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-2">
          <span className="text-sm font-medium">明暗</span>
          <div className="flex gap-2" role="group" aria-label="主题">
            {THEMES.map((item) => (
              <Button
                key={item.value}
                size="sm"
                variant={settings.theme === item.value ? 'primary' : 'secondary'}
                aria-pressed={settings.theme === item.value}
                disabled={!ready}
                onClick={() => void persist({ theme: item.value })}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>
      </Panel>

      <Panel className="grid gap-4">
        <SectionHeading
          title="壁纸"
          description="主界面与文章页各用一张；图片会复制进应用数据目录，不随数据库导出。"
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <WallpaperSlot slot="home" label="主界面壁纸" hint="显示在所有列表页背景" />
          <WallpaperSlot slot="article" label="文章页壁纸" hint="仅文章详情页背景" />
        </div>
      </Panel>

      <Panel className="grid gap-4">
        <SectionHeading title="数据库源" description="「检查更新 / 重新下载」与导入页共用这个地址。" />
        <label className="grid gap-1 text-sm">
          <span className="font-medium">默认数据库源</span>
          <input
            aria-label="默认数据库源"
            className={inputClass}
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="example/tpr-db 或 release 地址"
            disabled={!ready}
          />
          <span className="text-xs text-muted-foreground">
            `/import` 会预填这个地址。
          </span>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="font-medium">网络镜像前缀（可选）</span>
          <input
            aria-label="网络镜像前缀"
            className={inputClass}
            value={mirror}
            onChange={(event) => setMirror(event.target.value)}
            placeholder="https://mirror.example/gh/（留空 = 直连）"
            disabled={!ready}
          />
          <span className="text-xs text-muted-foreground">只改下载地址，GitHub API 仍直连。</span>
        </label>

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void persist({ defaultSource: source, mirrorPrefix: mirror })}>
            保存
          </Button>
          <Button disabled={checking} onClick={() => void checkUpdate()}>
            {checking ? '检查中…' : '检查更新'}
          </Button>
          <Button disabled={library.busy} onClick={() => void redownload()}>
            {library.busy ? '导入中…' : '重新下载并导入'}
          </Button>
        </div>

        {update !== null && (
          <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
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
        )}
      </Panel>

      <Panel className="grid gap-3">
        <SectionHeading
          title="关于"
          description="确认当前跑的是安装版还是免安装版；版本号来自 exe 自身，不是仓库里的 package.json。"
        />
        <dl className="grid gap-2 text-sm">
          <div className="flex flex-wrap gap-2">
            <dt className="w-20 shrink-0 text-muted-foreground">版本</dt>
            <dd className="font-mono">{runtime?.version ?? '—'}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="w-20 shrink-0 text-muted-foreground">运行方式</dt>
            <dd>
              {runtime
                ? runtime.mode === 'installed'
                  ? '安装版'
                  : '免安装版'
                : runtimeLoading
                  ? '读取中…'
                  : hasTauriInvoke()
                    ? '读取失败（详情见控制台）'
                    : '浏览器预览（无 Tauri）'}
            </dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="w-20 shrink-0 text-muted-foreground">程序路径</dt>
            <dd className="break-all font-mono text-xs">{runtime?.exePath ?? '—'}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="w-20 shrink-0 text-muted-foreground">数据目录</dt>
            <dd className="break-all font-mono text-xs">{runtime?.dataDir ?? services.platform.paths.dataDir}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="w-20 shrink-0 text-muted-foreground">安装版</dt>
            <dd className="break-all font-mono text-xs">
              {runtime?.install
                ? `${runtime.install.version || '未知版本'} · ${runtime.install.location}`
                : '未安装（当前为免安装版，或本机没有注册表记录）'}
            </dd>
          </div>
        </dl>
        {runtime?.install && runtime.install.version && runtime.install.version !== runtime.version ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            安装版仍是 {runtime.install.version}，与当前 {runtime.version} 不一致。双击仓库根目录的
            「发布更新.cmd」可一次性重建并覆盖两版。
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          升级：双击仓库根目录「发布更新.cmd」，或执行 `corepack pnpm release` —— 会重建、覆盖安装版、刷新
          `dist/portable/` 免安装目录，并核对两版版本号。
        </p>
      </Panel>

      <Panel tone="plain" className="rounded-xl border border-border bg-surface/40 p-5 text-sm text-muted-foreground">
        <p>
          当前库：{snapshot ? `${snapshot.manifest.name}（${snapshot.manifest.databaseId}，schema ${snapshot.manifest.schemaVersion}）` : '未打开'}
        </p>
        <p className="mt-1">数据库包版本：{currentVersion ?? '—'}</p>
      </Panel>
    </div>
  );
}
