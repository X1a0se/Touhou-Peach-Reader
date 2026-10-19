import { PlatformError } from '../errors.js';
import { normalizePath, joinPath } from '../paths.js';
import type { DirEntry, FileStat, IFileSystem } from '../types.js';

/**
 * 内存文件系统：测试与浏览器预览用。
 * 路径一律 POSIX 风格、以 `/` 开头；目录是隐式的（有子文件即存在）。
 */
export class InMemoryFileSystem implements IFileSystem {
  private readonly files = new Map<string, { bytes: Uint8Array; mtimeMs: number }>();
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  constructor(initial: Record<string, string | Uint8Array> = {}) {
    for (const [path, value] of Object.entries(initial)) {
      this.files.set(this.key(path), {
        bytes: typeof value === 'string' ? this.encoder.encode(value) : value,
        mtimeMs: Date.now(),
      });
    }
  }

  private key(path: string): string {
    return normalizePath(path) || '/';
  }

  private childKeys(dir: string): string[] {
    const prefix = dir === '/' ? '/' : `${dir}/`;
    return [...this.files.keys()].filter((k) => k.startsWith(prefix) && k !== dir);
  }

  async readText(path: string): Promise<string> {
    return this.decoder.decode(await this.readBytes(path));
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const entry = this.files.get(this.key(path));
    if (!entry) throw new PlatformError('ENOENT', `文件不存在：${path}`);
    return entry.bytes.slice();
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.writeBytes(path, this.encoder.encode(text));
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(this.key(path), { bytes: bytes.slice(), mtimeMs: Date.now() });
  }

  async exists(path: string): Promise<boolean> {
    const key = this.key(path);
    if (this.files.has(key)) return true;
    return this.childKeys(key).length > 0;
  }

  async stat(path: string): Promise<FileStat> {
    const key = this.key(path);
    const entry = this.files.get(key);
    if (entry) {
      return { size: entry.bytes.byteLength, mtimeMs: entry.mtimeMs, isFile: true, isDirectory: false };
    }
    if (this.childKeys(key).length > 0) {
      return { size: 0, mtimeMs: 0, isFile: false, isDirectory: true };
    }
    throw new PlatformError('ENOENT', `路径不存在：${path}`);
  }

  async listDir(path: string): Promise<DirEntry[]> {
    const dir = this.key(path);
    const prefix = dir === '/' ? '/' : `${dir}/`;
    const seen = new Map<string, DirEntry>();
    for (const key of this.childKeys(dir)) {
      const rest = key.slice(prefix.length);
      const name = rest.split('/')[0];
      if (!name) continue;
      const isDirectory = rest.includes('/');
      if (!seen.has(name)) {
        seen.set(name, { name, path: joinPath(dir, name), isDirectory });
      }
    }
    return [...seen.values()];
  }

  async mkdir(): Promise<void> {
    // 隐式目录：无需操作
  }

  async remove(path: string, opts?: { recursive?: boolean }): Promise<void> {
    const key = this.key(path);
    if (this.files.delete(key)) return;
    const children = this.childKeys(key);
    if (children.length === 0) throw new PlatformError('ENOENT', `路径不存在：${path}`);
    if (!opts?.recursive) throw new PlatformError('ENOTEMPTY', `目录非空：${path}`);
    for (const child of children) this.files.delete(child);
  }

  async rename(from: string, to: string): Promise<void> {
    const fromKey = this.key(from);
    const toKey = this.key(to);
    const entry = this.files.get(fromKey);
    if (entry) {
      this.files.delete(fromKey);
      this.files.set(toKey, entry);
      return;
    }
    const children = this.childKeys(fromKey);
    if (children.length === 0) throw new PlatformError('ENOENT', `路径不存在：${from}`);
    if (this.childKeys(toKey).length > 0) throw new PlatformError('ENOTEMPTY', `目标目录非空：${to}`);
    for (const child of children) {
      const moved = this.files.get(child);
      if (!moved) continue;
      this.files.delete(child);
      this.files.set(`${toKey}${child.slice(fromKey.length)}`, moved);
    }
  }

  async copy(from: string, to: string): Promise<void> {
    const fromKey = this.key(from);
    const toKey = this.key(to);
    const entry = this.files.get(fromKey);
    if (entry) {
      this.files.set(toKey, { bytes: entry.bytes.slice(), mtimeMs: Date.now() });
      return;
    }
    const children = this.childKeys(fromKey);
    if (children.length === 0) throw new PlatformError('ENOENT', `路径不存在：${from}`);
    for (const child of children) {
      const source = this.files.get(child);
      if (!source) continue;
      this.files.set(`${toKey}${child.slice(fromKey.length)}`, {
        bytes: source.bytes.slice(),
        mtimeMs: source.mtimeMs,
      });
    }
  }

  /** 测试辅助：列出全部文件路径 */
  snapshot(): string[] {
    return [...this.files.keys()].sort();
  }
}
