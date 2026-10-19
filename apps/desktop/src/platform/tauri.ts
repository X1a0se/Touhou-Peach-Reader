import { convertFileSrc } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';
import { openUrl } from '@tauri-apps/plugin-opener';
import { PlatformError } from '@tpr/platform';
import type {
  DirEntry,
  FileStat,
  IFileSystem,
  IZip,
  INetwork,
  Platform,
  ZipCreateResult,
  ZipExtractResult,
} from '@tpr/platform';

/**
 * Tauri 平台实现 —— 仓库里唯一允许 import @tauri-apps/* 的文件（design §3.2）。
 *
 * Goal 1 阶段：路径、资源 URL、外链、网络已可用；
 * 文件系统与 ZIP 在 Goal 3 换成 Rust 命令（自研命令统一校验"必须在 app data 目录内"）。
 */

const notYet = (what: string): Promise<never> =>
  Promise.reject(new PlatformError('ENOT_IMPLEMENTED', `${what} 将在 Goal 3 用 Rust 命令实现`));

class TauriFileSystem implements IFileSystem {
  readText(): Promise<string> {
    return notYet('fs.readText');
  }
  readBytes(): Promise<Uint8Array> {
    return notYet('fs.readBytes');
  }
  writeText(): Promise<void> {
    return notYet('fs.writeText');
  }
  writeBytes(): Promise<void> {
    return notYet('fs.writeBytes');
  }
  exists(): Promise<boolean> {
    return notYet('fs.exists');
  }
  stat(): Promise<FileStat> {
    return notYet('fs.stat');
  }
  listDir(): Promise<DirEntry[]> {
    return notYet('fs.listDir');
  }
  mkdir(): Promise<void> {
    return notYet('fs.mkdir');
  }
  remove(): Promise<void> {
    return notYet('fs.remove');
  }
  rename(): Promise<void> {
    return notYet('fs.rename');
  }
  copy(): Promise<void> {
    return notYet('fs.copy');
  }
}

class TauriZip implements IZip {
  extractAll(): Promise<ZipExtractResult> {
    return notYet('zip.extractAll');
  }
  extractBytes(): Promise<ZipExtractResult> {
    return notYet('zip.extractBytes');
  }
  createFromDir(): Promise<ZipCreateResult> {
    return notYet('zip.createFromDir');
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

  return {
    kind: 'tauri',
    fs: new TauriFileSystem(),
    zip: new TauriZip(),
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
        await openUrl(url);
      },
    },
    network,
  };
}
