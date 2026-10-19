import type { ZipLimits } from './types.js';

/**
 * 包内路径安全（design §5.5）：zip-slip、绝对路径、盘符、控制字符一律拒绝。
 * 这是导入前端的第一道闸，桌面端 Rust 侧还会再校验一次（双保险）。
 */

export const ZIP_LIMITS: ZipLimits = {
  maxEntries: 100_000,
  maxTotalBytes: 8 * 1024 * 1024 * 1024,
  maxFileBytes: 512 * 1024 * 1024,
  maxCompressionRatio: 200,
};

export type PathCheck = { ok: true; path: string } | { ok: false; reason: string };

const CONTROL = /[\u0000-\u001f]/;

export function safeEntryPath(entry: string): PathCheck {
  const raw = entry.replace(/\\/g, '/');
  if (raw.length === 0) return { ok: false, reason: '空路径' };
  if (raw.length > 400) return { ok: false, reason: '路径过长（>400）' };
  if (CONTROL.test(raw)) return { ok: false, reason: '包含控制字符' };
  if (raw.startsWith('/')) return { ok: false, reason: '绝对路径' };
  if (/^[a-zA-Z]:/.test(raw)) return { ok: false, reason: '包含盘符' };
  const segments = raw.split('/').filter((s) => s.length > 0 && s !== '.');
  if (segments.some((s) => s === '..')) return { ok: false, reason: '包含上跳目录（..）' };
  if (segments.length === 0) return { ok: false, reason: '空路径' };
  return { ok: true, path: segments.join('/') };
}

/** 相对路径是否可作为包内引用（content.file / image.file） */
export function isSafeRelativePath(path: string): boolean {
  return safeEntryPath(path).ok;
}
