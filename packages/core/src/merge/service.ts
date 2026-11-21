/**
 * 合并服务：把"另一个 .tpr"解到临时目录、算出预览，确认后写进当前 workspace。
 *
 * 纯计算在 `merge.ts`；这里只做 IO 编排。预览阶段**绝不改动**当前库，
 * 用户点"取消"只需要删临时目录（design §10.6）。
 */
import type { Platform } from '@tpr/platform';
import type { Library } from '../db/library.js';
import { normalizeDatabase } from '../db/normalize.js';
import { readDatabaseDir } from '../db/read.js';
import { type DBSnapshot, toSnapshot } from '../db/snapshot.js';
import { readImageBlob, writeImageBlob } from '../db/sql/store.js';
import { ioFor } from '../db/workspace.js';
import { type ProgressOptions, type ProgressPhase, ProgressRun } from '../progress.js';
import {
  applyConflicts,
  type Decision,
  type MergeReport,
  type MergeResult,
  mergeDatabases,
} from './merge.js';

export interface MergePreview {
  /** 临时目录名，用于取消时清理。 */
  id: string;
  dir: string;
  snapshot: DBSnapshot;
  contents: Map<string, string>;
  imageFiles: Map<string, { file: string }>;
  result: MergeResult;
}

export interface MergeOutcome {
  report: MergeReport;
  appliedConflicts: number;
}

/** 合并预览阶段：解压与读包占大头，图片哈希在图片多时也不便宜。 */
export const MERGE_PREPARE_PHASES: readonly ProgressPhase[] = [
  { key: 'extract', label: '正在解压待合并的包', weight: 0.45 },
  { key: 'read', label: '正在读取与校验数据', weight: 0.2 },
  { key: 'hash', label: '正在校验图片指纹', weight: 0.2 },
  { key: 'compare', label: '正在比对冲突', weight: 0.15 },
];

/** 合并应用阶段：正文写入、图片写入、整体落盘。 */
export const MERGE_APPLY_PHASES: readonly ProgressPhase[] = [
  { key: 'content', label: '正在写入正文', weight: 0.35 },
  { key: 'images', label: '正在写入图片', weight: 0.25 },
  { key: 'save', label: '正在保存数据库', weight: 0.4 },
];

export interface MergeService {
  prepare(zipPath: string, opts?: ProgressOptions): Promise<MergePreview>;
  /** decisions: conflictId → 裁决；未列出的冲突一律保留本地。 */
  apply(
    preview: MergePreview,
    decisions: Record<string, Decision>,
    opts?: ProgressOptions,
  ): Promise<MergeOutcome>;
  discard(preview: MergePreview): Promise<void>;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function createMergeService(platform: Platform, library: Library): MergeService {
  const io = ioFor(platform);

  async function readIfExists(path: string): Promise<Uint8Array | null> {
    try {
      return await platform.fs.readBytes(path);
    } catch {
      return null;
    }
  }

  async function discard(preview: MergePreview): Promise<void> {
    if (await platform.fs.exists(preview.dir)) {
      await platform.fs.remove(preview.dir, { recursive: true });
    }
  }

  return {
    async prepare(zipPath: string, opts: ProgressOptions = {}): Promise<MergePreview> {
      const run = new ProgressRun('merge', MERGE_PREPARE_PHASES, opts.onProgress, 'extract');
      const current = library.current();
      const baseSnapshot = library.snapshot();
      if (!current || !baseSnapshot) throw new Error('尚未打开数据库，无法合并');

      const id = `merge-${Date.now().toString(36)}`;
      const dir = platform.paths.join(platform.paths.dataDir, 'imports', id);
      await platform.fs.mkdir(dir);
      await platform.zip.extractAll(zipPath, dir, {
        onProgress: (done, total) => run.progress(done, total),
      });

      run.begin('read');
      const raw = await readDatabaseDir(io, dir, {
        onProgress: (done, total) => run.progress(done, total),
      });
      const { db } = normalizeDatabase(raw);

      // 图片元数据存在但包内文件缺失/不可读时，不能让它进入合并结果：
      // 否则 apply 只写元数据，SQLite 里会多出 data 为 NULL 的图片行。
      run.begin('hash');
      const keptImages: typeof db.images = [];
      const incomingHashes = new Map<string, string>();
      for (const [index, image] of db.images.entries()) {
        const bytes = await readIfExists(io.join(dir, image.file));
        if (!bytes) {
          run.progress(index + 1, db.images.length);
          continue;
        }
        keptImages.push(image);
        incomingHashes.set(image.id, await sha256Hex(bytes));
        run.progress(index + 1, db.images.length);
      }
      const snapshot = toSnapshot(
        keptImages.length === db.images.length ? db : { ...db, images: keptImages },
      );

      const contents = new Map<string, string>();
      for (const article of db.articles) {
        if (typeof article.content !== 'object' || article.content === null) continue;
        try {
          contents.set(article.id, await platform.fs.readText(io.join(dir, article.content.file)));
        } catch {
          contents.set(article.id, '');
        }
      }
      const imageFiles = new Map(keptImages.map((image) => [image.id, { file: image.file }]));

      const baseHashes = new Map<string, string | null>();
      for (const image of baseSnapshot.images) {
        const bytes = await readImageBlob(platform, current.dir, image.id);
        baseHashes.set(image.id, bytes ? await sha256Hex(bytes) : null);
      }
      run.begin('compare');
      const result = await mergeDatabases(
        { snapshot: baseSnapshot, hashImage: (imageId) => Promise.resolve(baseHashes.get(imageId) ?? null) },
        { snapshot, hashImage: (imageId) => Promise.resolve(incomingHashes.get(imageId) ?? null) },
      );

      run.finish();
      return { id, dir, snapshot, contents, imageFiles, result };
    },

    async apply(
      preview: MergePreview,
      decisions: Record<string, Decision>,
      opts: ProgressOptions = {},
    ): Promise<MergeOutcome> {
      const run = new ProgressRun('merge', MERGE_APPLY_PHASES, opts.onProgress, 'content');
      const current = library.current();
      if (!current) throw new Error('尚未打开数据库，无法合并');

      const decisionsMap = new Map(Object.entries(decisions));
      const { result, contents: conflictedContents } = applyConflicts(preview.result, decisionsMap, {
        snapshot: preview.snapshot,
        contents: preview.contents,
        imageFiles: preview.imageFiles,
      });
      const merged = result.merged;

      // 1. 正文：incoming 新增/更新的文章 + 被裁决为 take-incoming 的文章
      const contentIds = [...new Set([...preview.result.sources.articleContent, ...conflictedContents.keys()])];
      for (const [index, articleId] of contentIds.entries()) {
        const text = conflictedContents.get(articleId) ?? preview.contents.get(articleId) ?? '';
        await library.saveContent(articleId, text);
        run.progress(index + 1, contentIds.length);
      }

      // 2. 图片：incoming 新增的 + 裁决为 take-incoming 的，把字节写进本地 SQLite BLOB
      run.begin('images');
      const imageIds = new Set(preview.result.sources.imageBytes);
      for (const conflict of preview.result.report.conflicts) {
        if (conflict.collection !== 'images') continue;
        if (decisionsMap.get(conflict.conflictId) === 'take-incoming') imageIds.add(conflict.id);
      }
      const imageList = [...imageIds];
      for (const [index, imageId] of imageList.entries()) {
        const image = merged.images.find((item) => item.id === imageId);
        const source = preview.imageFiles.get(imageId);
        if (!image || !source) {
          run.progress(index + 1, imageList.length);
          continue;
        }
        const bytes = await readIfExists(io.join(preview.dir, source.file));
        if (!bytes) {
          run.progress(index + 1, imageList.length);
          continue;
        }
        await writeImageBlob(platform, current.dir, image, bytes);
        run.progress(index + 1, imageList.length);
      }

      // 3. 整体替换集合（applyEdit 会重算 counts、重建 filePaths、校验后落盘）
      run.begin('save');
      await library.applyEdit((draft) => {
        draft.authors = merged.authors as typeof draft.authors;
        draft.tags = merged.tags as typeof draft.tags;
        draft.images = merged.images as typeof draft.images;
        // snapshot 里的文章不含 content，落盘前必须补回
        draft.articles = merged.articles.map((article) => {
          const existing = draft.articles.find((item) => item.id === article.id);
          return {
            ...article,
            content: existing?.content ?? { file: `articles/${article.id}.md` },
          };
        }) as typeof draft.articles;
        draft.series = merged.series as typeof draft.series;
        draft.featured = merged.featured as typeof draft.featured;
        draft.credits = merged.credits as typeof draft.credits;
      });

      await discard(preview);
      run.finish();

      return {
        report: result.report,
        appliedConflicts: preview.result.report.conflicts.filter(
          (conflict) => decisionsMap.get(conflict.conflictId) === 'take-incoming',
        ).length,
      };
    },

    discard,
  };
}
