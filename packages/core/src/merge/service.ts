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

export interface MergeService {
  prepare(zipPath: string): Promise<MergePreview>;
  /** decisions: conflictId → 裁决；未列出的冲突一律保留本地。 */
  apply(preview: MergePreview, decisions: Record<string, Decision>): Promise<MergeOutcome>;
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
    async prepare(zipPath: string): Promise<MergePreview> {
      const current = library.current();
      const baseSnapshot = library.snapshot();
      if (!current || !baseSnapshot) throw new Error('尚未打开数据库，无法合并');

      const id = `merge-${Date.now().toString(36)}`;
      const dir = platform.paths.join(platform.paths.dataDir, 'imports', id);
      await platform.fs.mkdir(dir);
      await platform.zip.extractAll(zipPath, dir);

      const raw = await readDatabaseDir(io, dir);
      const { db } = normalizeDatabase(raw);
      const snapshot = toSnapshot(db);

      const contents = new Map<string, string>();
      for (const article of db.articles) {
        if (typeof article.content !== 'object' || article.content === null) continue;
        try {
          contents.set(article.id, await platform.fs.readText(io.join(dir, article.content.file)));
        } catch {
          contents.set(article.id, '');
        }
      }
      const imageFiles = new Map(db.images.map((image) => [image.id, { file: image.file }]));

      const baseHashes = new Map<string, string | null>();
      const incomingHashes = new Map<string, string | null>();
      for (const image of baseSnapshot.images) {
        const bytes = await readImageBlob(platform, current.dir, image.id);
        baseHashes.set(image.id, bytes ? await sha256Hex(bytes) : null);
      }
      for (const image of snapshot.images) {
        const bytes = await readIfExists(io.join(dir, image.file));
        incomingHashes.set(image.id, bytes ? await sha256Hex(bytes) : null);
      }

      const result = await mergeDatabases(
        { snapshot: baseSnapshot, hashImage: (imageId) => Promise.resolve(baseHashes.get(imageId) ?? null) },
        { snapshot, hashImage: (imageId) => Promise.resolve(incomingHashes.get(imageId) ?? null) },
      );

      return { id, dir, snapshot, contents, imageFiles, result };
    },

    async apply(preview: MergePreview, decisions: Record<string, Decision>): Promise<MergeOutcome> {
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
      const contentIds = new Set([...preview.result.sources.articleContent, ...conflictedContents.keys()]);
      for (const articleId of contentIds) {
        const text = conflictedContents.get(articleId) ?? preview.contents.get(articleId) ?? '';
        await library.saveContent(articleId, text);
      }

      // 2. 图片：incoming 新增的 + 裁决为 take-incoming 的，把字节写进本地 SQLite BLOB
      const imageIds = new Set(preview.result.sources.imageBytes);
      for (const conflict of preview.result.report.conflicts) {
        if (conflict.collection !== 'images') continue;
        if (decisionsMap.get(conflict.conflictId) === 'take-incoming') imageIds.add(conflict.id);
      }
      for (const imageId of imageIds) {
        const image = merged.images.find((item) => item.id === imageId);
        const source = preview.imageFiles.get(imageId);
        if (!image || !source) continue;
        const bytes = await readIfExists(io.join(preview.dir, source.file));
        if (!bytes) continue;
        await writeImageBlob(platform, current.dir, image, bytes);
      }

      // 3. 整体替换集合（applyEdit 会重算 counts、重建 filePaths、校验后落盘）
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
