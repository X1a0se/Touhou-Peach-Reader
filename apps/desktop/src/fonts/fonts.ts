/**
 * 本地字体：文件落在 `$APPDATA/fonts/`，元数据由 core 设置保存。
 *
 * 这里只做桌面端的事情：校验文件、读写字体字节、注册 FontFace。
 * core 不认识 DOM，也不保存字体二进制。
 */
import type { Platform } from '@tpr/platform';
import {
  MAX_READING_FONTS,
  type ReadingFontAsset,
  type ReadingFontFamily,
  type ReadingFontFormat,
  type ReadingTypographySettings,
} from '@tpr/core';

export const FONT_DIR = 'fonts';
export const FONT_ACCEPT = '.ttf,.otf,.woff,.woff2';
export const MAX_FONT_BYTES = 20 * 1024 * 1024;
export const MAX_FONT_COUNT = MAX_READING_FONTS;

export const READING_FONT_STACKS: Record<ReadingFontFamily, string> = {
  system: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
  serif: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, serif',
  sans: '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif',
  kai: 'KaiTi, STKaiti, "Noto Serif SC", serif',
};

const FONT_EXTENSIONS: Record<string, ReadingFontFormat> = {
  ttf: 'ttf',
  otf: 'otf',
  woff: 'woff',
  woff2: 'woff2',
};

const FONT_FAMILY_PREFIX = 'TPR Imported';
const registered = new Map<string, FontFace>();

export interface FontFileLike {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export function fontFormatForName(name: string): ReadingFontFormat | null {
  const match = /\.([^.]+)$/.exec(name.trim());
  const extension = match?.[1]?.toLowerCase();
  if (!extension) return null;
  return FONT_EXTENSIONS[extension] ?? null;
}

/** 返回中文错误；`null` 表示通过。 */
export function validateFontFile(file: Pick<FontFileLike, 'name' | 'size'>): string | null {
  if (fontFormatForName(file.name) === null) return '只支持 TTF / OTF / WOFF / WOFF2 字体文件';
  if (file.size <= 0) return '字体文件为空';
  if (file.size > MAX_FONT_BYTES) return '字体文件不能超过 20 MB';
  return null;
}

export function fontSignatureMatches(bytes: Uint8Array, format: ReadingFontFormat): boolean {
  if (bytes.length < 4) return false;
  const [b0 = 0, b1 = 0, b2 = 0, b3 = 0] = bytes;
  const tag = String.fromCharCode(b0, b1, b2, b3);
  if (format === 'otf') return tag === 'OTTO';
  if (format === 'woff') return tag === 'wOFF';
  if (format === 'woff2') return tag === 'wOF2';
  return (b0 === 0x00 && b1 === 0x01 && b2 === 0x00 && b3 === 0x00) || tag === 'true' || tag === 'typ1';
}

export function fontFilePath(platform: Platform, asset: ReadingFontAsset): string {
  return platform.paths.join(platform.paths.dataDir, FONT_DIR, asset.fileName);
}

function newFontId(): string {
  return `font_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function importFontAsset(platform: Platform, file: FontFileLike): Promise<ReadingFontAsset> {
  const invalid = validateFontFile(file);
  if (invalid !== null) throw new Error(invalid);
  const format = fontFormatForName(file.name);
  if (format === null) throw new Error('只支持 TTF / OTF / WOFF / WOFF2 字体文件');

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!fontSignatureMatches(bytes, format)) {
    throw new Error('文件内容不是有效的字体文件');
  }

  const id = newFontId();
  const fileName = `${id}.${format}`;
  const dir = platform.paths.join(platform.paths.dataDir, FONT_DIR);
  await platform.fs.mkdir(dir);
  await platform.fs.writeBytes(platform.paths.join(dir, fileName), bytes);

  const base = file.name.replace(/\.[^.]+$/, '').replace(/\s+/g, ' ').trim();
  return {
    id,
    name: (base || '本地字体').slice(0, 80),
    fileName,
    format,
    importedAt: new Date().toISOString(),
  };
}

export async function removeFontAsset(platform: Platform, asset: ReadingFontAsset): Promise<void> {
  await platform.fs.remove(fontFilePath(platform, asset)).catch(() => undefined);
}

/** 把设置里的字体注册为 FontFace；删除的字体同时从 document.fonts 移除。 */
export async function syncFontFaces(platform: Platform, assets: readonly ReadingFontAsset[]): Promise<void> {
  const desired = new Set(assets.map((asset) => `${FONT_FAMILY_PREFIX} ${asset.id}`));
  for (const [family, face] of registered) {
    if (desired.has(family)) continue;
    document.fonts.delete(face);
    registered.delete(family);
  }

  for (const asset of assets) {
    const family = `${FONT_FAMILY_PREFIX} ${asset.id}`;
    if (registered.has(family)) continue;
    try {
      const bytes = await platform.fs.readBytes(fontFilePath(platform, asset));
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const face = new FontFace(family, data);
      await face.load();
      document.fonts.add(face);
      registered.set(family, face);
    } catch (cause) {
      console.warn(
        `[fonts] 加载本地字体「${asset.name}」失败：${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }
}

/** 已导入字体优先，找不到时回退到预设字体栈。 */
export function fontStack(reading: ReadingTypographySettings): string {
  const preset = READING_FONT_STACKS[reading.fontFamily];
  if (reading.customFontId === null) return preset;
  return `"${FONT_FAMILY_PREFIX} ${reading.customFontId}", ${preset}`;
}
