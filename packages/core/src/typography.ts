/**
 * 阅读排版偏好（Goal 26）：全局设置，不按数据库隔离。
 *
 * 只保存“意图”（字体类别、字号、行距、段间距），具体字体栈由桌面端映射，
 * core 不依赖任何 UI 框架。
 */

export type ReadingFontFamily = 'system' | 'serif' | 'sans' | 'kai';

export type ReadingFontFormat = 'ttf' | 'otf' | 'woff' | 'woff2';

/** 导入到本机的字体；字体字节由桌面端存在 `$APPDATA/fonts/`，这里只存元数据。 */
export interface ReadingFontAsset {
  id: string;
  name: string;
  fileName: string;
  format: ReadingFontFormat;
  importedAt: string;
}

export const MAX_READING_FONTS = 20;

export const READING_FONT_FORMATS: readonly ReadingFontFormat[] = ['ttf', 'otf', 'woff', 'woff2'];

export interface ReadingTypographySettings {
  /** 字体类别；`system` 表示沿用界面默认字体 */
  fontFamily: ReadingFontFamily;
  /** 选中的本地字体 id；非空时覆盖 fontFamily 对应的字体栈 */
  customFontId: string | null;
  /** 正文字号（px） */
  fontSize: number;
  /** 行高倍数（无单位） */
  lineHeight: number;
  /** 段间距（em） */
  paragraphSpacing: number;
}

export const READING_FONT_FAMILIES: readonly { value: ReadingFontFamily; label: string }[] = [
  { value: 'system', label: '系统默认' },
  { value: 'serif', label: '衬线体' },
  { value: 'sans', label: '无衬线体' },
  { value: 'kai', label: '楷体' },
];

export const DEFAULT_READING_TYPOGRAPHY: ReadingTypographySettings = {
  fontFamily: 'system',
  customFontId: null,
  fontSize: 16,
  lineHeight: 1.85,
  paragraphSpacing: 0.9,
};

const FONT_FAMILIES = new Set<ReadingFontFamily>(READING_FONT_FAMILIES.map((item) => item.value));
const FONT_FORMATS = new Set<ReadingFontFormat>(READING_FONT_FORMATS);
const FONT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const FONT_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
};

function normalizeFontAsset(value: unknown): ReadingFontAsset | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const format = typeof raw.format === 'string' ? (raw.format as ReadingFontFormat) : null;
  const fileName = typeof raw.fileName === 'string' ? raw.fileName.trim() : '';
  const importedAt = typeof raw.importedAt === 'string' ? raw.importedAt.trim() : '';
  if (!FONT_ID_RE.test(id) || format === null || !FONT_FORMATS.has(format)) return null;
  if (!FONT_FILE_RE.test(fileName) || !fileName.toLowerCase().endsWith(`.${format}`)) return null;
  if (importedAt === '' || Number.isNaN(Date.parse(importedAt))) return null;
  const name = (typeof raw.name === 'string' ? raw.name : '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return {
    id,
    name: name || id,
    fileName,
    format,
    importedAt,
  };
}

/** 宽容解析字体列表：非法/重复条目丢弃，最多保留 MAX_READING_FONTS 个。 */
export function normalizeReadingFonts(value: unknown): ReadingFontAsset[] {
  if (!Array.isArray(value)) return [];
  const result: ReadingFontAsset[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const asset = normalizeFontAsset(item);
    if (!asset || seen.has(asset.id)) continue;
    seen.add(asset.id);
    result.push(asset);
    if (result.length >= MAX_READING_FONTS) break;
  }
  return result;
}

/** 宽容解析：坏字段回退默认值，并把数值夹在可用范围内。 */
export function normalizeReadingTypography(value: unknown): ReadingTypographySettings {
  const raw =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const fontFamily =
    typeof raw.fontFamily === 'string' && FONT_FAMILIES.has(raw.fontFamily as ReadingFontFamily)
      ? (raw.fontFamily as ReadingFontFamily)
      : DEFAULT_READING_TYPOGRAPHY.fontFamily;
  const customFontId =
    typeof raw.customFontId === 'string' && FONT_ID_RE.test(raw.customFontId.trim())
      ? raw.customFontId.trim()
      : null;
  return {
    fontFamily,
    customFontId,
    fontSize: Math.round(clampNumber(raw.fontSize, DEFAULT_READING_TYPOGRAPHY.fontSize, 14, 24)),
    lineHeight: Math.round(clampNumber(raw.lineHeight, DEFAULT_READING_TYPOGRAPHY.lineHeight, 1.4, 2.2) * 100) / 100,
    paragraphSpacing:
      Math.round(clampNumber(raw.paragraphSpacing, DEFAULT_READING_TYPOGRAPHY.paragraphSpacing, 0, 2) * 10) / 10,
  };
}
