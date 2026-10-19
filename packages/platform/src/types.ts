/**
 * 平台适配层接口（design §5.2）。
 *
 * 这是 core 与"操作系统/壳"之间唯一的缝：桌面端注入 Tauri 实现，
 * 测试与浏览器预览注入 `@tpr/platform/memory`。core 只认这些接口。
 */

export interface FileStat {
  size: number;
  mtimeMs: number;
  isFile: boolean;
  isDirectory: boolean;
}

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface IFileSystem {
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  writeText(path: string, text: string): Promise<void>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileStat>;
  listDir(path: string): Promise<DirEntry[]>;
  mkdir(path: string): Promise<void>;
  remove(path: string, opts?: { recursive?: boolean }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
}

export interface ZipLimits {
  maxEntries: number;
  maxTotalBytes: number;
  maxFileBytes: number;
  maxCompressionRatio: number;
}

export interface RejectedEntry {
  entry: string;
  reason: string;
}

export interface ZipExtractResult {
  entries: number;
  bytes: number;
  rejected: RejectedEntry[];
}

export interface ZipCreateResult {
  entries: number;
  bytes: number;
}

export interface IZip {
  /** 解压整个包到 destDir；zip-slip、符号链接、超限条目进 rejected，不中断整体 */
  extractAll(zipPath: string, destDir: string, opts?: { limits?: Partial<ZipLimits> }): Promise<ZipExtractResult>;
  /** 直接吃字节（浏览器/测试用） */
  extractBytes(bytes: Uint8Array, destDir: string, opts?: { limits?: Partial<ZipLimits> }): Promise<ZipExtractResult>;
  /** 把目录打成 zip；order 里的条目最后写入（manifest.json 用） */
  createFromDir(dirPath: string, zipPath: string, opts?: { order?: string[] }): Promise<ZipCreateResult>;
}

export interface IAppPaths {
  /** 应用数据根目录（桌面端 = $APPDATA/com.touhou.peachreader） */
  readonly dataDir: string;
  join(...parts: string[]): string;
  basename(path: string): string;
  dirname(path: string): string;
}

export interface IAssetUrls {
  readonly kind: 'asset-protocol' | 'blob' | 'none';
  /** 把本地绝对路径变成一个 <img src> 能用的 URL */
  toUrl(absPath: string): string;
}

export interface IOpener {
  openExternal(url: string): Promise<void>;
}

export interface INetwork {
  fetchJson<T>(url: string, opts?: { headers?: Record<string, string> }): Promise<T>;
  download(
    url: string,
    onProgress?: (received: number, total: number | undefined) => void,
  ): Promise<Uint8Array>;
}

export interface Platform {
  readonly kind: 'tauri' | 'memory' | 'web';
  readonly fs: IFileSystem;
  readonly zip: IZip;
  readonly paths: IAppPaths;
  readonly assets: IAssetUrls;
  readonly opener: IOpener;
  readonly network: INetwork;
}
