import { PlatformError } from '../errors.js';
import { basenamePath, dirnamePath, joinPath } from '../paths.js';
import type { INetwork, Platform } from '../types.js';
import { InMemoryFileSystem } from './fs.js';
import { FflateZip } from './zip.js';

export { InMemoryFileSystem } from './fs.js';
export { FflateZip } from './zip.js';

export interface MemoryPlatformOptions {
  dataDir?: string;
  files?: Record<string, string | Uint8Array>;
  /** 注入假的网络实现（测试 GitHub 下载用）；缺省一律 ENOT_IMPLEMENTED */
  network?: Partial<INetwork>;
}

/**
 * 内存平台：单元测试与 `pnpm dev:web` 的默认实现。
 * 不碰真实文件系统、不发网络请求；接口行为与桌面实现保持一致。
 */
export function createMemoryPlatform(opts: MemoryPlatformOptions = {}): Platform {
  const fs = new InMemoryFileSystem(opts.files);
  const dataDir = opts.dataDir ?? '/appdata';

  return {
    kind: 'memory',
    fs,
    zip: new FflateZip(fs),
    paths: {
      dataDir,
      join: joinPath,
      basename: basenamePath,
      dirname: dirnamePath,
    },
    assets: {
      kind: 'none',
      toUrl: (path) => path,
    },
    opener: {
      openExternal: async (url: string) => {
        if (typeof window !== 'undefined') {
          window.open(url, '_blank', 'noopener,noreferrer');
          return;
        }
        throw new PlatformError('ENOT_IMPLEMENTED', '当前环境无法打开外部链接');
      },
    },
    network: {
      fetchJson:
        opts.network?.fetchJson ??
        (async () => {
          throw new PlatformError('ENOT_IMPLEMENTED', '内存平台不支持网络请求');
        }),
      download:
        opts.network?.download ??
        (async () => {
          throw new PlatformError('ENOT_IMPLEMENTED', '内存平台不支持网络请求');
        }),
    },
  };
}
