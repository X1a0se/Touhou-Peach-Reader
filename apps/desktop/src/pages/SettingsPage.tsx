import {
  DEFAULT_DATABASE_SOURCE,
  MAX_READING_FONTS,
  READING_FONT_FAMILIES,
  REPOSITORY_URL,
} from '@tpr/core';
import type {
  AppUpdateCheck,
  PaletteId,
  ReadingFontAsset,
  ReadingTypographySettings,
  SettingsPatch,
  ThemeMode,
  UpdateCheck,
  WallpaperSettings,
} from '@tpr/core';
import { Button, Panel, SectionHeading } from '@tpr/ui';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocklist } from '../blocklist/BlocklistProvider.js';
import { useServices } from '../context.js';
import {
  FONT_ACCEPT,
  fontStack,
  importFontAsset,
  removeFontAsset,
  validateFontFile,
} from '../fonts/fonts.js';
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
  const blocklist = useBlocklist();

  const snapshot = library.snapshot;
  const currentVersion = snapshot?.manifest.version ?? null;

  const [source, setSource] = useState(settings.defaultSource);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  const [appChecking, setAppChecking] = useState(false);
  const [appUpdate, setAppUpdate] = useState<AppUpdateCheck | null>(null);
  const [appError, setAppError] = useState<string | null>(null);
  const [readingDraft, setReadingDraft] = useState<ReadingTypographySettings>(settings.reading);
  const [fontError, setFontError] = useState<string | null>(null);
  const [fontBusy, setFontBusy] = useState(false);
  const fontInputRef = useRef<HTMLInputElement | null>(null);
  const [tagQuery, setTagQuery] = useState('');
  const [runtime, setRuntime] = useState<AppRuntimeInfo | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(true);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [databaseName, setDatabaseName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameNotice, setNameNotice] = useState<string | null>(null);
  const appVersion = runtime?.version ?? services.app.getVersion();
  const availableTags = useMemo(() => {
    const keyword = tagQuery.trim().toLowerCase();
    const blocked = new Set(blocklist.ids);
    return (snapshot?.tags ?? [])
      .filter((tag) => !blocked.has(tag.id))
      .filter(
        (tag) =>
          keyword === '' ||
          tag.name.toLowerCase().includes(keyword) ||
          tag.aliases?.some((alias) => alias.toLowerCase().includes(keyword)) === true,
      )
      .slice(0, 60);
  }, [snapshot?.tags, blocklist.ids, tagQuery]);

  useEffect(() => {
    let alive = true;
    void getAppRuntimeInfo().then((info) => {
      if (!alive) return;
      setRuntimeLoading(false);
      if (info) setRuntime(info);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    setSource(settings.defaultSource);
  }, [ready]);

  useEffect(() => {
    setDatabaseName(snapshot?.manifest.name ?? '');
  }, [snapshot?.manifest.name]);

  useEffect(() => {
    if (!ready) return;
    setReadingDraft(settings.reading);
  }, [
    ready,
    settings.reading.fontFamily,
    settings.reading.customFontId,
    settings.reading.fontSize,
    settings.reading.lineHeight,
    settings.reading.paragraphSpacing,
  ]);

  const persist = async (patch: SettingsPatch): Promise<void> => {
    setError(null);
    try {
      await save(patch);
      setStatus('已保存');
    } catch (cause) {
      setError(describe(cause));
    }
  };

  const openRepository = async (): Promise<void> => {
    setRepoError(null);
    try {
      await services.platform.opener.openExternal(REPOSITORY_URL);
    } catch (cause) {
      setRepoError(describe(cause));
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
      const result = await services.github.checkUpdate(target, currentVersion, {
        localUpdatedAt: snapshot?.manifest.updatedAt ?? null,
      });
      setUpdate(result);
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setChecking(false);
    }
  };

  const checkAppUpdate = async (): Promise<void> => {
    setAppChecking(true);
    setAppError(null);
    setAppUpdate(null);
    try {
      const result = await services.github.checkAppUpdate(REPOSITORY_URL, appVersion);
      setAppUpdate(result);
    } catch (cause) {
      setAppError(describe(cause));
    } finally {
      setAppChecking(false);
    }
  };

  const openExternal = async (url: string): Promise<void> => {
    setRepoError(null);
    try {
      await services.platform.opener.openExternal(url);
    } catch (cause) {
      setRepoError(describe(cause));
    }
  };

  const openAppLink = async (url: string): Promise<void> => {
    setAppError(null);
    try {
      await services.platform.opener.openExternal(url);
    } catch (cause) {
      setAppError(describe(cause));
    }
  };

  const commitReadingDraft = (): void => {
    void persist({ reading: readingDraft });
  };

  const chooseReadingFont = (fontFamily: ReadingTypographySettings['fontFamily']): void => {
    const next = { ...readingDraft, fontFamily, customFontId: null };
    setReadingDraft(next);
    void persist({ reading: next });
  };

  const importLocalFont = async (file: File): Promise<void> => {
    setFontError(null);
    const invalid = validateFontFile(file);
    if (invalid !== null) {
      setFontError(invalid);
      return;
    }
    if (settings.fonts.length >= MAX_READING_FONTS) {
      setFontError(`最多只能导入 ${MAX_READING_FONTS} 个本地字体`);
      return;
    }
    setFontBusy(true);
    try {
      const asset = await importFontAsset(services.platform, file);
      const nextReading = { ...readingDraft, customFontId: asset.id };
      await persist({ fonts: [...settings.fonts, asset], reading: nextReading });
      setReadingDraft(nextReading);
    } catch (cause) {
      setFontError(describe(cause));
    } finally {
      setFontBusy(false);
    }
  };

  const useLocalFont = (asset: ReadingFontAsset): void => {
    const next = { ...readingDraft, customFontId: asset.id };
    setReadingDraft(next);
    void persist({ reading: next });
  };

  const deleteLocalFont = async (asset: ReadingFontAsset): Promise<void> => {
    if (!window.confirm(`删除本地字体「${asset.name}」？`)) return;
    setFontError(null);
    setFontBusy(true);
    try {
      await removeFontAsset(services.platform, asset);
      const nextReading =
        readingDraft.customFontId === asset.id ? { ...readingDraft, customFontId: null } : readingDraft;
      await persist({
        fonts: settings.fonts.filter((font) => font.id !== asset.id),
        reading: nextReading,
      });
      setReadingDraft(nextReading);
    } catch (cause) {
      setFontError(describe(cause));
    } finally {
      setFontBusy(false);
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
      const outcome = await library.importBytes(result.bytes);
      if (!outcome.ok) {
        setStatus(null);
        setError(outcome.error);
        return;
      }
      setStatus(`已导入 ${result.fileName}（${result.tag}）`);
      setUpdate(null);
    } catch (cause) {
      setStatus(null);
      setError(describe(cause));
    }
  };

  const renameDatabase = async (): Promise<void> => {
    if (!snapshot) return;
    setNameError(null);
    setNameNotice(null);
    setRenaming(true);
    try {
      await services.library.rename(databaseName);
      await library.refresh();
      setNameNotice('数据库名称已保存');
    } catch (cause) {
      setNameError(describe(cause));
    } finally {
      setRenaming(false);
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

      <Panel className="grid gap-5">
        <SectionHeading
          title="阅读排版"
          description="只作用于文章正文；足迹与系列进度不受影响。滑动后松手即保存。"
        />
        <div className="grid gap-2">
          <span className="text-sm font-medium">字体</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label="正文字体">
            {READING_FONT_FAMILIES.map((item) => (
              <Button
                key={item.value}
                size="sm"
                variant={readingDraft.customFontId === null && readingDraft.fontFamily === item.value ? 'primary' : 'secondary'}
                aria-pressed={readingDraft.customFontId === null && readingDraft.fontFamily === item.value}
                disabled={!ready}
                onClick={() => chooseReadingFont(item.value)}
              >
                {item.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={!ready || fontBusy || settings.fonts.length >= MAX_READING_FONTS}
              onClick={() => fontInputRef.current?.click()}
            >
              {fontBusy ? '处理中…' : '导入本地字体'}
            </Button>
            <span className="text-xs text-muted-foreground">
              支持 TTF / OTF / WOFF / WOFF2，单个不超过 20 MB；已导入 {settings.fonts.length}/{MAX_READING_FONTS}
            </span>
            <input
              ref={fontInputRef}
              type="file"
              accept={FONT_ACCEPT}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void importLocalFont(file);
              }}
            />
          </div>
          {fontError !== null ? <p className="text-xs text-red-500">{fontError}</p> : null}
          {settings.fonts.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {settings.fonts.map((asset) => {
                const active = readingDraft.customFontId === asset.id;
                return (
                  <li
                    key={asset.id}
                    className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 ${
                      active ? 'border-accent bg-accent-soft' : 'border-border'
                    }`}
                  >
                    <span className="min-w-0 truncate text-sm">{asset.name}</span>
                    <span className="text-[0.65rem] text-muted-foreground">
                      {asset.format.toUpperCase()} · {asset.importedAt.slice(0, 10)}
                    </span>
                    <span className="ml-auto flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant={active ? 'primary' : 'secondary'}
                        disabled={!ready || fontBusy}
                        onClick={() => useLocalFont(asset)}
                      >
                        {active ? '使用中' : '使用'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!ready || fontBusy}
                        onClick={() => void deleteLocalFont(asset)}
                      >
                        删除
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <div className="grid content-start gap-4">
            <label className="grid gap-1 text-sm">
              <span className="flex items-center justify-between">
                <span className="font-medium">字号</span>
                <span className="font-mono text-xs text-muted-foreground">{readingDraft.fontSize}px</span>
              </span>
              <input
                type="range"
                min={14}
                max={24}
                step={1}
                value={readingDraft.fontSize}
                disabled={!ready}
                aria-label="正文字号"
                className="w-full accent-[var(--accent)]"
                onChange={(event) =>
                  setReadingDraft((prev) => ({ ...prev, fontSize: Number(event.target.value) }))
                }
                onPointerUp={commitReadingDraft}
                onKeyUp={commitReadingDraft}
              />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="flex items-center justify-between">
                <span className="font-medium">行间距</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {readingDraft.lineHeight.toFixed(2)}
                </span>
              </span>
              <input
                type="range"
                min={1.4}
                max={2.2}
                step={0.05}
                value={readingDraft.lineHeight}
                disabled={!ready}
                aria-label="正文行间距"
                className="w-full accent-[var(--accent)]"
                onChange={(event) =>
                  setReadingDraft((prev) => ({ ...prev, lineHeight: Number(event.target.value) }))
                }
                onPointerUp={commitReadingDraft}
                onKeyUp={commitReadingDraft}
              />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="flex items-center justify-between">
                <span className="font-medium">段间距</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {readingDraft.paragraphSpacing.toFixed(1)}em
                </span>
              </span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={readingDraft.paragraphSpacing}
                disabled={!ready}
                aria-label="正文段间距"
                className="w-full accent-[var(--accent)]"
                onChange={(event) =>
                  setReadingDraft((prev) => ({ ...prev, paragraphSpacing: Number(event.target.value) }))
                }
                onPointerUp={commitReadingDraft}
                onKeyUp={commitReadingDraft}
              />
            </label>
          </div>

          <div className="rounded-xl border border-border bg-surface/60 p-4">
            <div className="mb-2 text-xs text-muted-foreground">预览</div>
            <div
              className="reading max-h-64 overflow-y-auto"
              style={
                {
                  '--reading-font-family': fontStack(readingDraft),
                  '--reading-font-size': `${readingDraft.fontSize}px`,
                  '--reading-line-height': String(readingDraft.lineHeight),
                  '--reading-paragraph-gap': `${readingDraft.paragraphSpacing}em`,
                } as CSSProperties
              }
            >
              <h2>幻想乡的午后</h2>
              <p>
                博丽神社的台阶被春日的阳光晒得发暖。灵梦把扫帚靠在柱子上，端起还冒着热气的茶。
              </p>
              <p>「今天的香客，大概又只有风吧。」她小声嘟囔，却并不真的在意。</p>
              <blockquote>段落之间留出呼吸的余地，读起来才不累。</blockquote>
              <ul>
                <li>字号随滑杆变化</li>
                <li>行距与段距各自独立</li>
              </ul>
            </div>
          </div>
        </div>
      </Panel>

      <Panel className="grid gap-4">
        <SectionHeading title="编辑器" description="控制编辑器与文章详情页之间的快捷入口。" />
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 shrink-0 accent-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
            checked={settings.showArticleEditorLink}
            disabled={!ready}
            onChange={(event) => void persist({ showArticleEditorLink: event.target.checked })}
          />
          <span>
            在文章详情页显示「编辑」入口
            <span className="mt-0.5 block text-xs text-muted-foreground">
              默认关闭；开启后可直接从文章页跳到编辑器中的对应文章。
            </span>
          </span>
        </label>
      </Panel>

      <Panel className="grid gap-4">
        <SectionHeading
          title="屏蔽标签"
          description="被屏蔽标签的文章、系列与标签本身会从搜索结果中排除；可在搜索页临时关闭。"
        />
        {blocklist.tags.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有屏蔽任何标签。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {blocklist.tags.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/60 px-3 py-1 text-sm"
              >
                <span className={tag.stale ? 'text-muted-foreground line-through' : ''}>#{tag.name}</span>
                {tag.stale ? <span className="text-[0.65rem] text-muted-foreground">已失效</span> : null}
                <button
                  type="button"
                  aria-label={`取消屏蔽 ${tag.name}`}
                  className="text-muted-foreground transition-colors hover:text-red-500"
                  onClick={() => void blocklist.remove(tag.id)}
                >
                  ×
                </button>
              </span>
            ))}
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => {
                if (window.confirm('确定清空屏蔽列表？')) void blocklist.clear();
              }}
            >
              全部取消
            </Button>
          </div>
        )}

        <div className="grid gap-2 border-t border-border pt-3">
          <span className="text-sm font-medium">添加屏蔽标签</span>
          <input
            aria-label="搜索要屏蔽的标签"
            className={inputClass}
            value={tagQuery}
            onChange={(event) => setTagQuery(event.target.value)}
            placeholder="输入标签名称或别名…"
            disabled={!snapshot}
          />
          <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto">
            {availableTags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => void blocklist.toggle({ id: tag.id, name: tag.name })}
                className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-red-400 hover:text-red-500"
              >
                + {tag.name}
              </button>
            ))}
            {snapshot && availableTags.length === 0 ? (
              <span className="text-xs text-muted-foreground">没有匹配的可添加标签。</span>
            ) : null}
            {!snapshot ? (
              <span className="text-xs text-muted-foreground">先导入数据库，才能选择标签。</span>
            ) : null}
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
        <SectionHeading
          title="数据库源"
          description="「检查更新 / 重新下载」与导入页共用这个地址；内置默认指向本项目的 GitHub 最新 Release。"
        />
        <label className="grid gap-1 text-sm">
          <span className="font-medium">默认数据库源</span>
          <input
            aria-label="默认数据库源"
            className={inputClass}
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder={DEFAULT_DATABASE_SOURCE}
            disabled={!ready}
          />
          <span className="text-xs text-muted-foreground">
            `/import` 会预填这个地址；支持 `owner/repo`、仓库地址、release 地址与资产直链。
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="break-all font-mono">{DEFAULT_DATABASE_SOURCE}</span>
          <Button size="sm" variant="ghost" disabled={!ready} onClick={() => setSource(DEFAULT_DATABASE_SOURCE)}>
            恢复内置默认
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void persist({ defaultSource: source })}>
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
              {update.assetName ? `（${update.assetName}）` : '（没有 .tpr 资产）'}
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

        <div className="grid gap-3 rounded-lg border border-border bg-surface/50 p-4">
          <p className="text-sm font-medium">自动更新</p>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 shrink-0 accent-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              checked={settings.autoCheckDatabaseUpdate}
              disabled={!ready}
              onChange={(event) =>
                void persist({ autoCheckDatabaseUpdate: event.target.checked })
              }
            />
            <span>
              启动时自动检查数据库更新
              <span className="mt-0.5 block text-xs text-muted-foreground">
                只检查并提示，不会覆盖当前数据库；检查失败会静默忽略。
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 shrink-0 accent-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              checked={settings.autoImportDatabaseUpdate}
              disabled={!ready || !settings.autoCheckDatabaseUpdate}
              onChange={(event) =>
                void persist({ autoImportDatabaseUpdate: event.target.checked })
              }
            />
            <span>
              发现更新后自动下载并导入
              <span className="mt-0.5 block text-xs text-muted-foreground">
                会用新数据库覆盖当前库的内容；默认关闭，建议先备份再开启。
              </span>
            </span>
          </label>
        </div>
      </Panel>

      <Panel className="grid gap-3">
        <SectionHeading title="项目仓库" description="源码、发布记录与问题反馈都在 GitHub 上。" />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => void openRepository()}>
            喜欢就给个star⭐吧
          </Button>
          <span className="break-all font-mono text-xs text-muted-foreground">{REPOSITORY_URL}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          遇到问题或想要新功能，欢迎到仓库提 Issue；如果它帮到了你，点一下 Star 就是最大的支持。
        </p>
        {repoError !== null && <p className="text-xs text-red-500">{repoError}</p>}
      </Panel>

      <Panel className="grid gap-3">
        <SectionHeading
          title="程序更新"
          description="从 GitHub Release 的程序资产名中解析最新版本，并与当前 exe 版本比较。"
        />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>
            当前程序版本：<span className="font-mono">{appVersion}</span>
          </span>
          <Button disabled={appChecking} onClick={() => void checkAppUpdate()}>
            {appChecking ? '检查中…' : '检查程序更新'}
          </Button>
        </div>
        {appError !== null ? (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
            {appError}
          </p>
        ) : null}
        {appUpdate !== null ? (
          <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
            <p className="font-medium">
              {appUpdate.upToDate
                ? `已是最新版本（${appUpdate.latest}）`
                : `发现新版本 ${appUpdate.latest}`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              当前版本 {appUpdate.current ?? '未知'}
              {appUpdate.publishedAt ? ` · 发布于 ${appUpdate.publishedAt.slice(0, 10)}` : ''}
            </p>
            {appUpdate.upToDate ? null : (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="primary" onClick={() => void openAppLink(appUpdate.releaseUrl)}>
                  打开发布页
                </Button>
                {appUpdate.setup ? (
                  <Button size="sm" onClick={() => void openAppLink(appUpdate.setup?.url ?? appUpdate.releaseUrl)}>
                    下载安装版
                  </Button>
                ) : null}
                {appUpdate.portable ? (
                  <Button size="sm" onClick={() => void openAppLink(appUpdate.portable?.url ?? appUpdate.releaseUrl)}>
                    下载免安装版
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
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

      <Panel className="grid gap-3">
        <SectionHeading
          title="当前数据库"
          description="名称只影响界面显示与导出文件名；databaseId、目录结构与文章数据都不变。"
        />
        {snapshot ? (
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void renameDatabase();
            }}
          >
            <label className="grid gap-1 text-sm">
              <span className="font-medium">数据库名称</span>
              <input
                aria-label="数据库名称"
                className={inputClass}
                value={databaseName}
                maxLength={200}
                placeholder="给这个库起个名字"
                disabled={renaming}
                onChange={(event) => {
                  setDatabaseName(event.target.value);
                  setNameError(null);
                  setNameNotice(null);
                }}
              />
              <span className="text-xs text-muted-foreground">
                1–200 个字符；保存后首页「当前数据库」、设置页与导出文件名立即更新。
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                variant="primary"
                disabled={
                  renaming ||
                  databaseName.trim() === '' ||
                  databaseName.trim() === snapshot.manifest.name
                }
              >
                {renaming ? '保存中…' : '保存名称'}
              </Button>
              <span className="break-all font-mono text-xs text-muted-foreground">
                {snapshot.manifest.databaseId} · schema {snapshot.manifest.schemaVersion} · 包版本{' '}
                {currentVersion ?? '—'}
              </span>
            </div>
            {nameError !== null && <p className="text-xs text-red-500">{nameError}</p>}
            {nameNotice !== null && (
              <p className="text-xs text-emerald-600 dark:text-emerald-300">{nameNotice}</p>
            )}
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">尚未打开数据库。</p>
        )}
      </Panel>
    </div>
  );
}
