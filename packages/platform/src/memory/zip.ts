import { unzipSync, zipSync } from 'fflate';
import { PlatformError } from '../errors.js';
import { joinPath } from '../paths.js';
import { ZIP_LIMITS, safeEntryPath } from '../security.js';
import type {
  IFileSystem,
  IZip,
  RejectedEntry,
  ZipCreateOptions,
  ZipCreateResult,
  ZipExtractOptions,
  ZipExtractResult,
  ZipLimits,
} from '../types.js';

/**
 * 基于 fflate 的 ZIP 实现：浏览器与 Node 都能跑（测试用）。
 * 桌面端用 Rust 流式实现替换，但语义必须与这里一致（同样的 rejected / 限额）。
 */
/**
 * 让出一次事件循环。
 *
 * 浏览器预览用的是内存平台：解压与写库都是同步 CPU 工作，微任务会把渲染饿死，
 * 进度条要等到全部做完才画得出来。带进度回调时定期 setTimeout(0) 让出主线程，
 * 预览里的进度才和桌面端（每步都是跨进程 IPC）一样是"活的"。
 * 测试与桌面端不受影响：没有 onProgress 时一次都不会让出。
 */
const yieldToPaint = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export class FflateZip implements IZip {
  constructor(private readonly fs: IFileSystem) {}

  async extractAll(
    zipPath: string,
    destDir: string,
    opts?: ZipExtractOptions,
  ): Promise<ZipExtractResult> {
    const bytes = await this.fs.readBytes(zipPath);
    return this.extractBytes(bytes, destDir, opts);
  }

  async extractBytes(
    bytes: Uint8Array,
    destDir: string,
    opts?: ZipExtractOptions,
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

    // 目录条目也算"处理过一条"：进度按条目总数推进，而不是只按落盘文件数（Goal 31）。
    const allEntries = Object.entries(unzipped);
    const totalEntries = allEntries.length;
    let processed = 0;
    const step = () => opts?.onProgress?.(processed, totalEntries);

    for (const [name, data] of allEntries) {
      processed += 1;
      if (opts?.onProgress && processed % 64 === 0) await yieldToPaint();
      if (name.endsWith('/')) {
        step();
        continue;
      }
      if (entries >= limits.maxEntries) {
        rejected.push({ entry: name, reason: `超过条目数上限（${limits.maxEntries}）` });
        step();
        continue;
      }
      const check = safeEntryPath(name);
      if (!check.ok) {
        rejected.push({ entry: name, reason: check.reason });
        step();
        continue;
      }
      if (data.byteLength > limits.maxFileBytes) {
        rejected.push({ entry: name, reason: `单文件超过 ${limits.maxFileBytes} 字节` });
        step();
        continue;
      }
      if (total + data.byteLength > limits.maxTotalBytes) {
        rejected.push({ entry: name, reason: '解压后总量超过上限' });
        step();
        continue;
      }
      total += data.byteLength;
      entries += 1;
      await this.fs.writeBytes(joinPath(destDir, check.path), data);
      step();
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
    opts?: ZipCreateOptions,
  ): Promise<ZipCreateResult> {
    // 先只收路径（不读字节），拿到总数后逐文件读取并上报进度：
    // 图片多的库读取是主要开销，zipSync 本身只是一次同步压缩。
    const files: { relative: string; path: string }[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await this.fs.listDir(dir)) {
        if (entry.isDirectory) {
          await walk(entry.path);
          continue;
        }
        files.push({
          relative: entry.path.slice(dirPath.length).replace(/^\/+/, ''),
          path: entry.path,
        });
      }
    };
    await walk(dirPath);
    files.sort((a, b) => a.relative.localeCompare(b.relative));

    const collected: Record<string, Uint8Array> = {};
    let entries = 0;
    let total = 0;
    for (const [index, file] of files.entries()) {
      if (opts?.onProgress) await yieldToPaint();
      const bytes = await this.fs.readBytes(file.path);
      collected[file.relative] = bytes;
      entries += 1;
      total += bytes.byteLength;
      opts?.onProgress?.(index + 1, files.length);
    }

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
  }}
