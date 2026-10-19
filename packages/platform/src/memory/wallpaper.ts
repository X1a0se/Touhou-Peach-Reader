import { PlatformError } from '../errors.js';
import { basenamePath } from '../paths.js';
import type { IFileSystem, IWallpaperStore } from '../types.js';

const MAX_BYTES = 20 * 1024 * 1024;
const EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;
const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const triple = (a << 16) | (b << 8) | c;
    out += BASE64[(triple >> 18) & 63];
    out += BASE64[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? BASE64[(triple >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? BASE64[triple & 63] : '=';
  }
  return out;
}

/**
 * 内存平台壁纸存储：字节留在进程内，`toUrl` 返回 data URL。
 * 语义与桌面实现一致（扩展名白名单、20MB 上限），只是不落盘。
 */
export function createMemoryWallpapers(fs: IFileSystem): IWallpaperStore {
  const files = new Map<string, { bytes: Uint8Array; ext: string }>();
  let counter = 0;

  return {
    async importFile(absPath: string) {
      const name = basenamePath(absPath);
      const dot = name.lastIndexOf('.');
      const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
      if (!(EXTENSIONS as readonly string[]).includes(ext)) {
        throw new PlatformError('EINVAL', `不支持的壁纸格式：${ext === '' ? '未知' : ext}`);
      }
      const bytes = await fs.readBytes(absPath);
      if (bytes.byteLength > MAX_BYTES) {
        throw new PlatformError('E_TOO_LARGE', '壁纸不能超过 20 MB');
      }
      counter += 1;
      const fileName = `memory-wallpaper-${counter}.${ext}`;
      files.set(fileName, { bytes, ext });
      return { fileName, bytes: bytes.byteLength };
    },
    async remove(fileName: string) {
      files.delete(fileName);
    },
    toUrl(fileName: string) {
      if (fileName === '') return '';
      const entry = files.get(fileName);
      if (!entry) return '';
      return `data:${MIME[entry.ext] ?? 'application/octet-stream'};base64,${encodeBase64(entry.bytes)}`;
    },
  };
}
