import { createMemoryPlatform } from '@tpr/platform/memory';
import type { RawDatabase } from '@tpr/schema';
import { makeArticle, makeDatabase } from '@tpr/schema/testing';
import { describe, expect, it } from 'vitest';
import { createLibrary } from '../src/db/library.js';
import { toSnapshot, type DBSnapshot } from '../src/db/snapshot.js';
import { ioFor } from '../src/db/workspace.js';
import { serializeDatabase, writeDatabaseDir } from '../src/db/write.js';
import { applyConflicts, mergeDatabases, type MergeSide } from '../src/merge/merge.js';
import { createMergeService } from '../src/merge/service.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** 每个 side 一个内存平台，图片字节由调用方给定（默认按 id 区分）。 */
function side(raw: RawDatabase | DBSnapshot, bytesById: Map<string, Uint8Array> = new Map()): MergeSide {
  const snapshot = 'maps' in raw ? (raw as DBSnapshot) : toSnapshot(raw);
  return {
    snapshot,
    hashImage: async (imageId) => {
      const bytes = bytesById.get(imageId);
      if (!bytes) return `missing:${imageId}`;
      return sha256Hex(bytes);
    },
  };
}

function withArticleTitle(raw: RawDatabase, articleId: string, title: string, updatedAt: string): RawDatabase {
  const next = clone(raw);
  const article = next.articles.find((item) => item.id === articleId);
  if (!article) throw new Error(`缺少文章 ${articleId}`);
  article.title = title;
  article.updatedAt = updatedAt;
  return next;
}

async function seedZip(
  platform: ReturnType<typeof createMemoryPlatform>,
  dir: string,
  raw: RawDatabase,
): Promise<string> {
  const io = ioFor(platform);
  const markdown = new Map(raw.articles.map((article) => [article.id, `# ${article.title}\n\n正文 ${article.id}\n`]));
  await writeDatabaseDir(io, dir, serializeDatabase(raw, markdown));
  for (const image of raw.images) {
    const path = platform.paths.join(dir, image.file);
    await platform.fs.mkdir(platform.paths.dirname(path));
    await platform.fs.writeBytes(path, new Uint8Array([1, 2, 3, 4]));
  }
  const zipPath = platform.paths.join(platform.paths.dataDir, `${dir.replaceAll('/', '_')}.tpr`);
  await platform.fs.mkdir(platform.paths.dirname(zipPath));
  await platform.zip.createFromDir(dir, zipPath, { order: ['manifest.json'] });
  return zipPath;
}

describe('merge: 多库合并（Goal 10）', () => {
  it('merge-newer-wins: updatedAt 较新的 incoming 覆盖 base，并记入 updated', async () => {
    const base = makeDatabase();
    const articleId = base.articles[0]?.id ?? '';
    const incoming = withArticleTitle(base, articleId, '新标题', '2030-01-01T00:00:00.000Z');

    const result = await mergeDatabases(side(base), side(incoming));
    const merged = result.merged.articles.find((item) => item.id === articleId);
    expect(merged?.title).toBe('新标题');
    expect(result.report.updated.articles).toBe(1);
    expect(result.report.conflicts).toHaveLength(0);
    expect(result.sources.articleContent.has(articleId)).toBe(true);
  });

  it('merge-same-content: 时间戳相同且内容相同 → 不算冲突', async () => {
    const base = makeDatabase();
    const incoming = clone(base);
    const result = await mergeDatabases(side(base), side(incoming));
    expect(result.report.conflicts).toHaveLength(0);
    expect(result.report.added.articles).toBe(0);
    expect(result.report.updated.articles).toBe(0);
  });

  it('merge-conflict-take-incoming: 同时间戳不同内容 → 冲突，裁决后取 incoming 正文', async () => {
    const base = makeDatabase();
    const articleId = base.articles[0]?.id ?? '';
    const incoming = clone(base);
    const article = incoming.articles.find((item) => item.id === articleId);
    if (!article) throw new Error('missing');
    article.title = '另一版标题';

    const result = await mergeDatabases(side(base), side(incoming));
    expect(result.report.conflicts).toHaveLength(1);
    const conflict = result.report.conflicts[0];
    expect(conflict?.conflictId).toBe(`articles:${articleId}`);
    expect(conflict?.fields).toContain('title');

    const contents = new Map([[articleId, '另一版正文']]);
    const resolved = applyConflicts(result, new Map([[`articles:${articleId}`, 'take-incoming']]), {
      snapshot: toSnapshot(incoming),
      contents,
      imageFiles: new Map(),
    });
    expect(resolved.result.report.conflicts).toHaveLength(0);
    expect(resolved.result.merged.articles.find((item) => item.id === articleId)?.title).toBe('另一版标题');
    expect(resolved.contents.get(articleId)).toBe('另一版正文');
  });

  it('merge-images: 同 id 不同字节 → binary-different 冲突', async () => {
    const base = makeDatabase();
    const incoming = clone(base);
    const imageId = base.images[0]?.id ?? '';
    const baseBytes = new Map([[imageId, new Uint8Array([1, 2, 3])]]);
    const incomingBytes = new Map([[imageId, new Uint8Array([9, 9, 9])]]);

    const result = await mergeDatabases(side(base, baseBytes), side(incoming, incomingBytes));
    const conflict = result.report.conflicts.find((item) => item.collection === 'images');
    expect(conflict?.kind).toBe('binary-different');
    expect(conflict?.id).toBe(imageId);
  });

  it('merge-idempotent: 同一 incoming 合并两次不会重复新增', async () => {
    const base = makeDatabase();
    const incoming = makeDatabase();
    const extra = makeArticle({ title: '只有 incoming 有的短篇' });
    incoming.articles.push(extra);

    const first = await mergeDatabases(side(base), side(incoming));
    expect(first.report.added.articles).toBe(first.merged.articles.length - base.articles.length);

    const second = await mergeDatabases(side(first.merged), side(incoming));
    expect(second.report.added.articles).toBe(0);
    expect(second.merged.articles.length).toBe(first.merged.articles.length);
  });

  it('merge-service-roundtrip: prepare→apply 落盘，再导出导入无重复实体', async () => {
    const baseRaw = makeDatabase();
    const basePlatform = createMemoryPlatform({ dataDir: '/app' });
    const baseZip = await seedZip(basePlatform, '/seed-base', baseRaw);
    const library = createLibrary(basePlatform);
    await library.importBytes(await basePlatform.fs.readBytes(baseZip));

    const articleId = baseRaw.articles[0]?.id ?? '';
    const incomingRaw = withArticleTitle(baseRaw, articleId, '合并进来的标题', '2031-05-05T00:00:00.000Z');
    const extra = makeArticle({ title: '合并新增短篇' });
    incomingRaw.articles.push(extra);

    const incomingPlatform = createMemoryPlatform({ dataDir: '/inc' });
    const incomingZip = await seedZip(incomingPlatform, '/inc/data', incomingRaw);
    const incomingBytes = await incomingPlatform.fs.readBytes(incomingZip);

    // 把 incoming 包放到 base 平台可读的位置（合并服务只认文件路径）
    const staged = basePlatform.paths.join(basePlatform.paths.dataDir, 'incoming.tpr');
    await basePlatform.fs.mkdir(basePlatform.paths.dirname(staged));
    await basePlatform.fs.writeBytes(staged, incomingBytes);

    const merge = createMergeService(basePlatform, library);
    const preview = await merge.prepare(staged);
    expect(preview.result.report.base.databaseId).toBe(library.snapshot()?.manifest.databaseId);
    expect(preview.result.report.added.articles).toBe(1);

    await merge.apply(preview, {});
    const after = library.snapshot();
    expect(after?.articles.find((item) => item.id === articleId)?.title).toBe('合并进来的标题');
    expect(after?.articles.find((item) => item.id === extra.id)?.title).toBe('合并新增短篇');
    expect(await library.readContent(extra.id)).toContain('正文');

    const exported = await library.export({ all: true });
    const fresh = createMemoryPlatform({ dataDir: '/fresh' });
    const freshLibrary = createLibrary(fresh);
    await freshLibrary.importBytes(exported.bytes);
    const roundtrip = freshLibrary.snapshot();
    const ids = roundtrip?.articles.map((item) => item.id) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
    expect(roundtrip?.articles.length).toBe(after?.articles.length);
    expect(roundtrip?.authors.length).toBe(after?.authors.length);
    expect(roundtrip?.series.length).toBe(after?.series.length);
  });

  it('merge-dangling: 合并后悬空引用进 report.dangling 而不是抛错', async () => {
    const base = makeDatabase();
    const incoming = clone(base);
    const article = incoming.articles[0];
    if (!article) throw new Error('missing');
    article.authorIds = ['p_0000000000ff'];
    article.updatedAt = '2032-01-01T00:00:00.000Z';

    const result = await mergeDatabases(side(base), side(incoming));
    const codes = result.report.dangling.map((issue) => issue.code);
    expect(codes).toContain('W_DANGLING_AUTHOR');
  });
});

export type { DBSnapshot };
