import { unzipSync, zipSync } from 'fflate';
import { PlatformError } from '../errors.js';
import { joinPath } from '../paths.js';
import { ZIP_LIMITS, safeEntryPath } from '../security.js';
import type { IFileSystem, IZip, RejectedEntry, ZipCreateResult, ZipExtractResult, ZipLimits } from '../types.js';

/**
 * 基于 fflate 的 ZIP 实现：浏览器与 Node 都能跑（测试用）。
 * 桌面端用 Rust 流式实现替换，但语义必须与这里一致（同样的 rejected / 限额）。
 */
export class FflateZip implements IZip {
  constructor(private readonly fs: IFileSystem) {}

  async extractAll(
    zipPath: string,
    destDir: string,
    opts?: { limits?: Partial<ZipLimits> },
  ): Promise<ZipExtractResult> {
    const bytes = await this.fs.readBytes(zipPath);
    return this.extractBytes(bytes, destDir, opts);
  }

  async extractBytes(
    bytes: Uint8Array,
    destDir: string,
    opts?: { limits?: Partial<ZipLimits> },
  ): Promise<ZipExtractResult> {
    const limits: ZipLimits = { ...ZIP_LIMITS, ...opts?.limits };
    let unzipped: Record<string, Uint8Array>;
    try {
      unzipped = unzipSync(bytes);
    } catch (error) {
      throw new PlatformError('EIO', 'ZIP 解析失败：文件可能损坏或不是 ZIP 格式', error);
    }

    const rejected: RejectedEntry[] = [];
    let entries = 0;
    let total = 0;

    for (const [name, data] of Object.entries(unzipped)) {
      if (name.endsWith('/')) continue;
      if (entries >= limits.maxEntries) {
        rejected.push({ entry: name, reason: `超过条目数上限（${limits.maxEntries}）` });
        continue;
      }
      const check = safeEntryPath(name);
      if (!check.ok) {
        rejected.push({ entry: name, reason: check.reason });
        continue;
      }
      if (data.byteLength > limits.maxFileBytes) {
        rejected.push({ entry: name, reason: `单文件超过 ${limits.maxFileBytes} 字节` });
        continue;
      }
      if (total + data.byteLength > limits.maxTotalBytes) {
        rejected.push({ entry: name, reason: '解压后总量超过上限' });
        continue;
      }
      total += data.byteLength;
      entries += 1;
      await this.fs.writeBytes(joinPath(destDir, check.path), data);
    }

    if (bytes.byteLength > 0 && total > 64 * 1024 * 1024 && total / bytes.byteLength > limits.maxCompressionRatio) {
      throw new PlatformError('EIO', `压缩比异常（${Math.round(total / bytes.byteLength)}×），疑似压缩炸弹`);
    }

    return { entries, bytes: total, rejected };
  }

  async createFromDirTo(
    dirPath: string,
    targetPath: string,
    opts?: { order?: string[] },
  ): Promise<ZipCreateResult> {
    return this.createFromDir(dirPath, targetPath, opts);
  }

  async createFromDir(
    dirPath: string,
    zipPath: string,
    opts?: { order?: string[] },
  ): Promise<ZipCreateResult> {
    const collected: Record<string, Uint8Array> = {};
    let entries = 0;
    let total = 0;

    const walk = async (dir: string): Promise<void> => {
      for (const entry of await this.fs.listDir(dir)) {
        if (entry.isDirectory) {
          await walk(entry.path);
          continue;
        }
        const relative = entry.path.slice(dirPath.length).replace(/^\/+/, '');
        const bytes = await this.fs.readBytes(entry.path);
        collected[relative] = bytes;
        entries += 1;
        total += bytes.byteLength;
      }
    };
    await walk(dirPath);

    // 让指定条目最后写入（manifest.json 放最后，中途失败即为不完整包）
    const ordered: Record<string, Uint8Array> = {};
    const last = new Set(opts?.order ?? []);
    for (const [name, data] of Object.entries(collected)) if (!last.has(name)) ordered[name] = data;
    for (const name of opts?.order ?? []) {
      const data = collected[name];
      if (data) ordered[name] = data;
    }

    const zipped = zipSync(ordered, { level: 6 });
    await this.fs.writeBytes(zipPath, zipped);
    return { entries, bytes: zipped.byteLength };
  }
}
