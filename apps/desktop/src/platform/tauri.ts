import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';
import { openUrl } from '@tauri-apps/plugin-opener';
import { PlatformError, mapNativeError } from '@tpr/platform';
import type {
  DirEntry,
  FileStat,
  IFileSystem,
  IZip,
  INetwork,
  Platform,
  RejectedEntry,
  ZipCreateResult,
  ZipExtractResult,
} from '@tpr/platform';

/**
 * Tauri 平台实现 —— 仓库里唯一允许 import @tauri-apps/* 的文件（design §3.2）。
 *
 * Goal 1 阶段：路径、资源 URL、外链、网络已可用；
 * 文件系统与 ZIP 在 Goal 3 换成 Rust 命令（自研命令统一校验"必须在 app data 目录内"）。
 */

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
    const data = await call<number[]>('fs_read_bytes', { path });
    return Uint8Array.from(data);
  }
  async writeText(path: string, text: string): Promise<void> {
    return call('fs_write_text', { path, text });
  }
  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    return call('fs_write_bytes', { path, bytes: Array.from(bytes) });
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

class TauriZip implements IZip {
  constructor(
    private readonly fs: IFileSystem,
    private readonly dataDir: string,
    private readonly join: (...parts: string[]) => string,
  ) {}

  async extractAll(zipPath: string, destDir: string): Promise<ZipExtractResult> {
    const result = await call<{ entries: number; bytes: number; rejected: RejectedEntry[] }>(
      'zip_extract_all',
      { zipPath, destDir },
    );
    return result;
  }

  /** 字节入口：先落到 app data 下的临时 .tpr，再交给 Rust 流式解压。 */
  async extractBytes(bytes: Uint8Array, destDir: string): Promise<ZipExtractResult> {
    const tmp = this.join(this.dataDir, 'imports', `incoming-${Date.now()}.tpr`);
    await this.fs.writeBytes(tmp, bytes);
    try {
      return await this.extractAll(tmp, destDir);
    } finally {
      await this.fs.remove(tmp).catch(() => undefined);
    }
  }

  async createFromDir(dirPath: string, zipPath: string, opts?: { order?: string[] }): Promise<ZipCreateResult> {
    return call('zip_create_from_dir', { dirPath, zipPath, order: opts?.order ?? ['manifest.json'] });
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
    const response = await fetch(url);
    if (!response.ok) {
      throw new PlatformError('EIO', `下载失败（HTTP ${response.status}）：${url}`);
    }
    const lengthHeader = response.headers.get('content-length');
    const total = lengthHeader ? Number(lengthHeader) : undefined;

    if (!response.body) {
      const buffer = new Uint8Array(await response.arrayBuffer());
      onProgress?.(buffer.byteLength, total);
      return buffer;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        onProgress?.(received, total);
      }
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged;
  },
};

export async function createTauriPlatform(): Promise<Platform> {
  const dataDir = await appDataDir();
  const tools = makePathTools(dataDir);
  const fs = new TauriFileSystem();
  const zip = new TauriZip(fs, dataDir, tools.join);

  return {
    kind: 'tauri',
    fs,
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
  };
}
