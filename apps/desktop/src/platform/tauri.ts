import { Channel, convertFileSrc, invoke } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';
import { openUrl } from '@tauri-apps/plugin-opener';
import type {
  BlobSource,
  DirEntry,
  FileStat,
  IFileSystem,
  INetwork,
  ISql,
  IWallpaperStore,
  IZip,
  Platform,
  RejectedEntry,
  SqlBulkResult,
  SqlBulkStatement,
  SqlRow,
  SqlStatement,
  SqlValue,
  ZipCreateOptions,
  ZipCreateResult,
  ZipExtractOptions,
  ZipExtractResult,
  SqlBulkOptions,
} from '@tpr/platform';
import { mapNativeError, PlatformError } from '@tpr/platform';

/**
 * Tauri 平台实现 —— 仓库里唯一允许 import @tauri-apps/* 的文件（design §3.2）。
 *
 * Goal 1 阶段：路径、资源 URL、外链、网络已可用；
 * 文件系统与 ZIP 在 Goal 3 换成 Rust 命令（自研命令统一校验"必须在 app data 目录内"）。
 */

/** 条目级进度：Rust 侧按步长回推 {done,total}。 */
interface EntryProgressPayload {
  done: number;
  total: number;
}

/**
 * 把 onProgress 包成 Tauri Channel。
 *
 * Rust 侧的参数是必填的 Channel（Tauri 的 Channel 不支持 Option），所以即使调用方
 * 不需要进度也照样创建一个通道，只是 onmessage 什么都不做——代价可忽略。
 */
function entryChannel(
  onProgress: ((done: number, total: number) => void) | undefined,
): Channel<EntryProgressPayload> {
  const channel = new Channel<EntryProgressPayload>();
  channel.onmessage = ({ done, total }) => {
    onProgress?.(done, total);
  };
  return channel;
}

/** 自研命令统一返回 `Err("ECODE: ...")`，这里统一转成 PlatformError。 */
const call = async <T>(command: string, args: Record<string, unknown> = {}): Promise<T> => {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw mapNativeError(error);
  }
};

class TauriFileSystem implements IFileSystem {
  async readText(path: string): Promise<string> {
    return call('fs_read_text', { path });
  }
  async readBytes(path: string): Promise<Uint8Array> {
    const raw = await call<unknown>('fs_read_bytes', { path });
    const bytes = bytesOf(raw);
    if (bytes === null) throw new PlatformError('EIO', '文件读取返回了不支持的数据类型');
    return bytes;
  }
  async writeText(path: string, text: string): Promise<void> {
    return call('fs_write_text', { path, text });
  }
  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    // base64 而不是 number[]：大型 .tpr（几十 MB）的序列化开销断崖式下降
    return call('fs_write_bytes', { path, base64: base64Of(bytes) });
  }
  async exists(path: string): Promise<boolean> {
    return call('fs_exists', { path });
  }
  async stat(path: string): Promise<FileStat> {
    return call('fs_stat', { path });
  }
  async listDir(path: string): Promise<DirEntry[]> {
    return call('fs_list_dir', { path });
  }
  async mkdir(path: string): Promise<void> {
    return call('fs_mkdir', { path });
  }
  async remove(path: string, opts?: { recursive?: boolean }): Promise<void> {
    return call('fs_remove', { path, recursive: opts?.recursive === true });
  }
  async rename(from: string, to: string): Promise<void> {
    return call('fs_rename', { from, to });
  }
  async copy(from: string, to: string): Promise<void> {
    return call('fs_copy', { from, to });
  }
}

/** 把一个字节数组编码成 base64（分块，避免超长参数列表爆栈）。 */
function base64Of(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(offset, offset + CHUNK) as unknown as number[],
    );
  }
  return btoa(binary);
}

function bytesOf(value: unknown): Uint8Array | null {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
    return Uint8Array.from(value as number[]);
  }
  return null;
}

class TauriSql implements ISql {
  async query(path: string, sql: string, params: SqlValue[] = []): Promise<SqlRow[]> {
    return call('sql_query', { path, sql, params });
  }

  async batch(path: string, statements: SqlStatement[]): Promise<void> {
    return call('sql_batch', {
      path,
      statements: statements.map((statement) => ({
        sql: statement.sql,
        params: statement.params ?? [],
      })),
    });
  }

  async readBlob(path: string, sql: string, params: SqlValue[] = []): Promise<Uint8Array | null> {
    const raw = await call<unknown>('sql_read_blob', { path, sql, params });
    const bytes = bytesOf(raw);
    if (bytes === null) {
      throw new PlatformError('EIO', 'SQL 图片读取返回了不支持的数据类型');
    }
    return bytes.byteLength === 0 ? null : bytes;
  }

  async readBlobToFile(
    path: string,
    sql: string,
    params: SqlValue[],
    targetPath: string,
  ): Promise<boolean> {
    return call('sql_read_blob_to_file', { path, sql, params, targetPath });
  }

  async writeBlob(
    path: string,
    sql: string,
    params: SqlValue[],
    source: BlobSource,
  ): Promise<void> {
    if (source instanceof Uint8Array) {
      return call('sql_write_blob', { path, sql, params, base64: base64Of(source) });
    }
    return call('sql_write_blob', { path, sql, params, sourcePath: source.file });
  }

  async bulkWrite(
    path: string,
    statements: SqlBulkStatement[],
    opts?: SqlBulkOptions,
  ): Promise<SqlBulkResult> {
    return call<SqlBulkResult>('sql_bulk_write', {
      path,
      statements: statements.map((statement) => ({
        sql: statement.sql,
        params: statement.params ?? [],
        ...(statement.source ? { source: statement.source } : {}),
      })),
      onProgress: entryChannel(opts?.onProgress),
    });
  }
}

class TauriZip implements IZip {
  constructor(
    private readonly fs: IFileSystem,
    private readonly dataDir: string,
    private readonly join: (...parts: string[]) => string,
  ) {}

  async extractAll(
    zipPath: string,
    destDir: string,
    opts?: ZipExtractOptions,
  ): Promise<ZipExtractResult> {
    const result = await call<{ entries: number; bytes: number; rejected: RejectedEntry[] }>(
      'zip_extract_all',
      { zipPath, destDir, onProgress: entryChannel(opts?.onProgress) ?? null },
    );
    return result;
  }

  /** 字节入口：先落到 app data 下的临时 .tpr，再交给 Rust 流式解压。 */
  async extractBytes(
    bytes: Uint8Array,
    destDir: string,
    opts?: ZipExtractOptions,
  ): Promise<ZipExtractResult> {
    const tmp = this.join(this.dataDir, 'imports', `incoming-${Date.now()}.tpr`);
    await this.fs.writeBytes(tmp, bytes);
    try {
      return await this.extractAll(tmp, destDir, opts);
    } finally {
      await this.fs.remove(tmp).catch(() => undefined);
    }
  }

  async createFromDir(
    dirPath: string,
    zipPath: string,
    opts?: ZipCreateOptions,
  ): Promise<ZipCreateResult> {
    return call('zip_create_from_dir', {
      dirPath,
      zipPath,
      order: opts?.order ?? ['manifest.json'],
      onProgress: entryChannel(opts?.onProgress),
    });
  }

  async createFromDirTo(
    dirPath: string,
    targetPath: string,
    opts?: ZipCreateOptions,
  ): Promise<ZipCreateResult> {
    return call('zip_create_from_dir_to', {
      dirPath,
      targetPath,
      order: opts?.order ?? ['manifest.json'],
      onProgress: entryChannel(opts?.onProgress),
    });
  }
}

class TauriWallpapers implements IWallpaperStore {
  constructor(
    private readonly fs: IFileSystem,
    private readonly dataDir: string,
    private readonly join: (...parts: string[]) => string,
  ) {}

  async importFile(absPath: string): Promise<{ fileName: string; bytes: number }> {
    return call('import_wallpaper', { sourcePath: absPath });
  }

  async remove(fileName: string): Promise<void> {
    if (fileName === '') return;
    await this.fs.remove(this.join(this.dataDir, 'wallpapers', fileName)).catch(() => undefined);
  }

  toUrl(fileName: string): string {
    if (fileName === '') return '';
    return convertFileSrc(this.join(this.dataDir, 'wallpapers', fileName));
  }
}

function makePathTools(dataDir: string) {
  const sep = dataDir.includes('\\') ? '\\' : '/';
  const trimTail = (p: string): string => p.replace(/[\\/]+$/, '');
  const trimHead = (p: string): string => p.replace(/^[\\/]+/, '');

  return {
    join: (...parts: string[]): string =>
      parts
        .filter((p) => p.length > 0)
        .map((p, i) => (i === 0 ? trimTail(p) : trimTail(trimHead(p))))
        .join(sep),
    basename: (p: string): string => {
      const clean = trimTail(p);
      const idx = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
      return idx === -1 ? clean : clean.slice(idx + 1);
    },
    dirname: (p: string): string => {
      const clean = trimTail(p);
      const idx = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
      return idx <= 0 ? clean : clean.slice(0, idx);
    },
  };
}

const network: INetwork = {
  async fetchJson<T>(url: string, opts?: { headers?: Record<string, string> }): Promise<T> {
    const init: RequestInit = opts?.headers ? { headers: opts.headers } : {};
    const response = await fetch(url, init);
    if (!response.ok) {
      throw new PlatformError('EIO', `请求失败（HTTP ${response.status}）：${url}`);
    }
    return (await response.json()) as T;
  },

  async download(
    url: string,
    onProgress?: (received: number, total: number | undefined) => void,
  ): Promise<Uint8Array> {
    const channel = new Channel<{ received: number; total: number | null }>();
    channel.onmessage = ({ received, total }) => {
      onProgress?.(received, total ?? undefined);
    };
    const buffer = await call<ArrayBuffer>('network_download', { url, progress: channel });
    return new Uint8Array(buffer);
  },
};

export async function createTauriPlatform(): Promise<Platform> {
  const dataDir = await appDataDir();
  const tools = makePathTools(dataDir);
  const fs = new TauriFileSystem();
  const sql = new TauriSql();
  const zip = new TauriZip(fs, dataDir, tools.join);
  const wallpapers = new TauriWallpapers(fs, dataDir, tools.join);

  return {
    kind: 'tauri',
    fs,
    sql,
    zip,
    paths: {
      dataDir,
      join: tools.join,
      basename: tools.basename,
      dirname: tools.dirname,
    },
    assets: {
      kind: 'asset-protocol',
      toUrl: (absPath: string) => convertFileSrc(absPath),
      imageUrl: (databaseDir: string, imageId: string) => {
        const databaseId = tools.basename(databaseDir);
        const safe = /^[A-Za-z0-9_-]{1,128}$/;
        if (!safe.test(databaseId) || !safe.test(imageId)) return null;
        const useHttp = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
        return `${useHttp ? 'http://peach.localhost' : 'peach://localhost'}/image/${databaseId}/${imageId}`;
      },
    },
    opener: {
      async openExternal(url: string): Promise<void> {
        if (!/^https?:\/\//i.test(url)) {
          throw new PlatformError('EINVAL', `只允许打开 http(s) 链接：${url}`);
        }
        try {
          await openUrl(url);
        } catch (cause) {
          // plugin-opener 拒绝时抛的是裸字符串（Not allowed to open url …），统一包成 PlatformError
          throw mapNativeError(cause, 'EACCES');
        }
      },
    },
    network,
    wallpapers,
  };
}
