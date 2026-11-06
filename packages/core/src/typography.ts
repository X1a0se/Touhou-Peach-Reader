/**
 * 阅读排版偏好（Goal 26）：全局设置，不按数据库隔离。
 *
 * 只保存“意图”（字体类别、字号、行距、段间距），具体字体栈由桌面端映射，
 * core 不依赖任何 UI 框架。
 */

export type ReadingFontFamily = 'system' | 'serif' | 'sans' | 'kai';

export interface ReadingTypographySettings {
  /** 字体类别；`system` 表示沿用界面默认字体 */
  fontFamily: ReadingFontFamily;
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
  fontSize: 16,
  lineHeight: 1.85,
  paragraphSpacing: 0.9,
};

const FONT_FAMILIES = new Set<ReadingFontFamily>(READING_FONT_FAMILIES.map((item) => item.value));

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
};

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
  return {
    fontFamily,
    fontSize: Math.round(clampNumber(raw.fontSize, DEFAULT_READING_TYPOGRAPHY.fontSize, 14, 24)),
    lineHeight: Math.round(clampNumber(raw.lineHeight, DEFAULT_READING_TYPOGRAPHY.lineHeight, 1.4, 2.2) * 100) / 100,
    paragraphSpacing:
      Math.round(clampNumber(raw.paragraphSpacing, DEFAULT_READING_TYPOGRAPHY.paragraphSpacing, 0, 2) * 10) / 10,
  };
}
