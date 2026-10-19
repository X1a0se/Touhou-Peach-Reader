/**
 * 全局设置（design §9.1）。
 *
 * 设置是"用户态"数据：存 `$APPDATA/com.touhou.peachreader/settings.json`，
 * 不进数据库包、不参与导出与合并。
 */

import type { Platform, ZipLimits } from '@tpr/platform';

export type ThemeMode = 'light' | 'dark' | 'system';

/** 配色方案（Goal 14）：每套都有独立的浅色与深色色值，见 packages/ui/src/styles.css */
export type PaletteId = 'peach' | 'bamboo' | 'moon' | 'scarlet' | 'ink';

export const PALETTE_IDS = ['peach', 'bamboo', 'moon', 'scarlet', 'ink'] as const;

/** 壁纸槽位：主界面与文章页各一份 */
export interface WallpaperSettings {
  /** 存储在 `$APPDATA/wallpapers/` 下的文件名；空串 = 未设置 */
  file: string;
  /** 不透明度 0.1–1 */
  opacity: number;
  /** 模糊半径 0–20 px */
  blur: number;
}

export const WALLPAPER_DIR = 'wallpapers';
export const WALLPAPER_MAX_BYTES = 20 * 1024 * 1024;
export const WALLPAPER_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;

export const DEFAULT_WALLPAPER: WallpaperSettings = { file: '', opacity: 0.45, blur: 0 };

export interface AppSettings {
  /** 明暗三档（Goal 11 设置页）：light / dark / system */
  theme: ThemeMode;
  /** 配色方案（Goal 14） */
  palette: PaletteId;
  /** 主界面（Layout）与文章详情页各自一张壁纸（Goal 14） */
  wallpapers: { home: WallpaperSettings; article: WallpaperSettings };
  /** 界面语言，v1 只有 zh-CN（见设计 U2） */
  language: string;
  /** 默认数据库源（GitHub 仓库或 release 地址，空串 = 未设置） */
  defaultSource: string;
  /** 网络镜像前缀（如 `https://ghproxy.example/`，空串 = 直连） */
  mirrorPrefix: string;
  /** 解压限额覆盖（默认取 design §7.4 的 512MB / 8GB / 20 万条 / 200 倍） */
  extractLimits?: Partial<ZipLimits>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  palette: 'peach',
  wallpapers: { home: { ...DEFAULT_WALLPAPER }, article: { ...DEFAULT_WALLPAPER } },
  language: 'zh-CN',
  defaultSource: '',
  mirrorPrefix: '',
};

const WALLPAPER_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** 只接受放在壁纸目录里的裸文件名，挡住 `..`、`/`、盘符与奇怪扩展名 */
export function sanitizeWallpaperFile(value: unknown): string {
  if (typeof value !== 'string') return '';
  const name = value.trim();
  if (!WALLPAPER_FILE_RE.test(name)) return '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  const ext = name.slice(dot + 1).toLowerCase();
  return (WALLPAPER_EXTENSIONS as readonly string[]).includes(ext) ? name : '';
}

export function clampWallpaperOpacity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_WALLPAPER.opacity;
  return Math.min(1, Math.max(0.1, value));
}

export function clampWallpaperBlur(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(20, Math.max(0, Math.round(value)));
}

function asPalette(value: unknown): PaletteId {
  return (PALETTE_IDS as readonly string[]).includes(String(value)) ? (value as PaletteId) : 'peach';
}

function parseWallpaper(value: unknown): WallpaperSettings {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_WALLPAPER };
  }
  const raw = value as Record<string, unknown>;
  return {
    file: sanitizeWallpaperFile(raw.file),
    opacity: clampWallpaperOpacity(raw.opacity),
    blur: clampWallpaperBlur(raw.blur),
  };
}

/** 壁纸文件的绝对路径；未设置时返回空串 */
export function wallpaperPath(platform: Platform, fileName: string): string {
  const clean = sanitizeWallpaperFile(fileName);
  if (clean === '') return '';
  return platform.paths.join(platform.paths.dataDir, WALLPAPER_DIR, clean);
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asTheme(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

function asLimit(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** 宽容解析：坏字段回退默认值，不让一个手改错的字段挡住启动 */
export function parseSettings(value: unknown): AppSettings | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const wallpapersSource =
    raw.wallpapers !== null && typeof raw.wallpapers === 'object' && !Array.isArray(raw.wallpapers)
      ? (raw.wallpapers as Record<string, unknown>)
      : {};
  const next: AppSettings = {
    theme: asTheme(raw.theme),
    palette: asPalette(raw.palette),
    wallpapers: {
      home: parseWallpaper(wallpapersSource.home),
      article: parseWallpaper(wallpapersSource.article),
    },
    language: asString(raw.language, 'zh-CN').slice(0, 32) || 'zh-CN',
    defaultSource: asString(raw.defaultSource, '').slice(0, 2000),
    mirrorPrefix: asString(raw.mirrorPrefix, '').slice(0, 2000),
  };
  if (raw.extractLimits !== null && typeof raw.extractLimits === 'object' && !Array.isArray(raw.extractLimits)) {
    const limits = raw.extractLimits as Record<string, unknown>;
    const parsed: Partial<ZipLimits> = {};
    const entries = asLimit(limits.maxEntries);
    const total = asLimit(limits.maxTotalBytes);
    const file = asLimit(limits.maxFileBytes);
    const ratio = asLimit(limits.maxCompressionRatio);
    if (entries !== undefined) parsed.maxEntries = Math.floor(entries);
    if (total !== undefined) parsed.maxTotalBytes = Math.floor(total);
    if (file !== undefined) parsed.maxFileBytes = Math.floor(file);
    if (ratio !== undefined) parsed.maxCompressionRatio = ratio;
    if (Object.keys(parsed).length > 0) next.extractLimits = parsed;
  }
  return next;
}

export interface SettingsLoadResult {
  settings: AppSettings;
  /** 文件不存在 / 损坏时的提示（不阻塞启动） */
  warning?: string;
}

export interface WallpaperPatch {
  file?: string;
  opacity?: number;
  blur?: number;
}

/** 部分更新：wallpapers 只合并到对应槽位，不动另一个槽位 */
export type SettingsPatch = Partial<Omit<AppSettings, 'wallpapers' | 'extractLimits'>> & {
  wallpapers?: { home?: WallpaperPatch; article?: WallpaperPatch };
  extractLimits?: Partial<ZipLimits>;
};

export interface SettingsService {
  /** 读盘一次；后续调用返回缓存 */
  load(): Promise<AppSettings>;
  /** 同步读缓存（未 load 时是默认值），供同步渲染使用 */
  get(): AppSettings;
  save(patch: SettingsPatch): Promise<AppSettings>;
  reset(): Promise<AppSettings>;
  /** 文件路径，便于设置页展示与排错 */
  readonly path: string;
}

function sanitize(input: AppSettings): AppSettings {
  const next: AppSettings = {
    theme: input.theme,
    palette: asPalette(input.palette),
    wallpapers: {
      home: parseWallpaper(input.wallpapers?.home),
      article: parseWallpaper(input.wallpapers?.article),
    },
    language: input.language.trim() || 'zh-CN',
    defaultSource: input.defaultSource.trim(),
    mirrorPrefix: input.mirrorPrefix.trim(),
  };
  if (input.extractLimits !== undefined && Object.keys(input.extractLimits).length > 0) {
    next.extractLimits = { ...input.extractLimits };
  }
  return next;
}

export function createSettings(platform: Platform): SettingsService {
  const path = platform.paths.join(platform.paths.dataDir, 'settings.json');
  let current: AppSettings = { ...DEFAULT_SETTINGS };
  let loaded = false;
  let loading: Promise<AppSettings> | null = null;

  async function read(): Promise<SettingsLoadResult> {
    if (!(await platform.fs.exists(path))) {
      return { settings: { ...DEFAULT_SETTINGS } };
    }
    let text: string;
    try {
      text = await platform.fs.readText(path);
    } catch (cause) {
      return {
        settings: { ...DEFAULT_SETTINGS },
        warning: `设置文件无法读取，已使用默认设置：${cause instanceof Error ? cause.message : String(cause)}`,
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { settings: { ...DEFAULT_SETTINGS }, warning: '设置文件不是合法 JSON，已使用默认设置' };
    }
    const result = parseSettings(parsed);
    if (result === null) {
      return { settings: { ...DEFAULT_SETTINGS }, warning: '设置文件字段不合法，已使用默认设置' };
    }
    return { settings: sanitize(result) };
  }

  async function write(next: AppSettings): Promise<void> {
    const tmp = `${path}.tmp`;
    await platform.fs.writeText(tmp, `${JSON.stringify(next, null, 2)}\n`);
    await platform.fs.rename(tmp, path);
  }

  return {
    path,
    get: () => current,
    load: async () => {
      if (loaded) return current;
      loading ??= (async () => {
        const result = await read();
        current = result.settings;
        loaded = true;
        if (result.warning !== undefined) {
          // 不打断启动；设置页会显示默认值
          console.warn(`[settings] ${result.warning}`);
        }
        return current;
      })();
      return loading;
    },
    save: async (patch) => {
      const base = loaded ? current : await read().then((r) => r.settings);
      const merged = sanitize({
        ...base,
        ...patch,
        extractLimits: { ...base.extractLimits, ...patch.extractLimits },
        wallpapers: {
          home: { ...base.wallpapers.home, ...patch.wallpapers?.home },
          article: { ...base.wallpapers.article, ...patch.wallpapers?.article },
        },
      });
      await write(merged);
      current = merged;
      loaded = true;
      return current;
    },
    reset: async () => {
      await platform.fs.remove(path).catch(() => undefined);
      current = { ...DEFAULT_SETTINGS };
      loaded = true;
      return current;
    },
  };
}

/** 镜像前缀拼装：空串 = 直连；有前缀 = `${prefix}/${原始 URL}` */
export function applyMirrorPrefix(url: string, prefix: string): string {
  const trimmed = prefix.trim();
  if (trimmed.length === 0) return url;
  return `${trimmed.replace(/\/+$/, '')}/${url}`;
}
