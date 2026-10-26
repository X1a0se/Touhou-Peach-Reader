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

/** SQL 参数/结果值；BLOB 不走普通查询，见 ISql 的专用方法。 */
export type SqlValue = string | number | null;

export interface SqlStatement {
  sql: string;
  params?: SqlValue[];
}

export type SqlRow = Record<string, SqlValue>;

/** 图片等 BLOB 的来源：已在 JS 里的字节，或允许平台直接从文件读取。 */
export type BlobSource = Uint8Array | { file: string };

/**
 * 通用 SQL 接口（本地数据库使用）。
 *
 * - 所有路径都是调用方给定的绝对路径，platform 负责实际的 SQLite 驱动。
 * - batch 必须是单个事务；query 不支持 BLOB。
 * - writeBlob 的 SQL 约定最后一个占位符是 BLOB，平台把 source 作为最后一项绑定。
 */
export interface ISql {
  query(path: string, sql: string, params?: SqlValue[]): Promise<SqlRow[]>;
  batch(path: string, statements: SqlStatement[]): Promise<void>;
  readBlob(path: string, sql: string, params?: SqlValue[]): Promise<Uint8Array | null>;
  readBlobToFile(
    path: string,
    sql: string,
    params: SqlValue[],
    targetPath: string,
  ): Promise<boolean>;
  writeBlob(path: string, sql: string, params: SqlValue[], source: BlobSource): Promise<void>;
}

export interface IZip {
  /** 解压整个包到 destDir；zip-slip、符号链接、超限条目进 rejected，不中断整体 */
  extractAll(zipPath: string, destDir: string, opts?: { limits?: Partial<ZipLimits> }): Promise<ZipExtractResult>;
  /** 直接吃字节（浏览器/测试用） */
  extractBytes(bytes: Uint8Array, destDir: string, opts?: { limits?: Partial<ZipLimits> }): Promise<ZipExtractResult>;
  /** 把目录打成 zip；order 里的条目最后写入（manifest.json 用） */
  createFromDir(dirPath: string, zipPath: string, opts?: { order?: string[] }): Promise<ZipCreateResult>;
  /**
   * 把目录直接写成目标 zip（桌面端用于导出：ZIP 字节不回传 JS）。
   * 语义与 createFromDir 相同，只是命名强调目标由调用方选定。
   */
  createFromDirTo(dirPath: string, targetPath: string, opts?: { order?: string[] }): Promise<ZipCreateResult>;
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
  /**
   * 本地数据库里的图片 BLOB → <img src> URL。
   * 平台不支持（内存/浏览器）时缺省，调用方回退到 toUrl。
   */
  imageUrl?(databaseDir: string, imageId: string): string | null;
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

/**
 * 壁纸存储（Goal 14）。
 *
 * 用户从系统对话框选中的图片在 app data 之外，必须先复制进 `$APPDATA/wallpapers/`
 * 才能被 asset 协议读取；复制与图片校验放在平台实现里（桌面端走 Rust 命令）。
 */
export interface IWallpaperStore {
  /** 从绝对路径导入一张图片；返回存储名与字节数 */
  importFile(absPath: string): Promise<{ fileName: string; bytes: number }>;
  /** 删除存储的壁纸（不存在时静默） */
  remove(fileName: string): Promise<void>;
  /** 存储名 → CSS background 可用的 URL；空串返回 '' */
  toUrl(fileName: string): string;
}

export interface Platform {
  readonly kind: 'tauri' | 'memory' | 'web';
  readonly fs: IFileSystem;
  readonly zip: IZip;
  readonly sql: ISql;
  readonly paths: IAppPaths;
  readonly assets: IAssetUrls;
  readonly opener: IOpener;
  readonly network: INetwork;
  readonly wallpapers: IWallpaperStore;
}
