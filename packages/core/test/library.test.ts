import { createMemoryPlatform } from '@tpr/platform/memory';
import type { RawDatabase } from '@tpr/schema';
import { makeDatabase } from '@tpr/schema/testing';
import { describe, expect, it } from 'vitest';
import { createLibrary } from '../src/db/library.js';
import { ioFor } from '../src/db/workspace.js';
import { serializeDatabase, writeDatabaseDir } from '../src/db/write.js';

const markdownFor = (db: RawDatabase): Map<string, string> =>
  new Map(db.articles.map((a) => [a.id, `# ${a.title}\n\n正文内容：${a.id}\n`]));

/** 把库物化成一个源目录，再打成 .tpr —— 模拟"别人做的包"。 */
async function packDatabase(db: RawDatabase, workDir: string): Promise<{ bytes: Uint8Array; markdown: Map<string, string> }> {
  const platform = createMemoryPlatform({ dataDir: workDir });
  const io = ioFor(platform);
  const markdown = markdownFor(db);
  await writeDatabaseDir(io, workDir, serializeDatabase(db, markdown));
  for (const image of db.images) {
    const path = platform.paths.join(workDir, image.file);
    await platform.fs.mkdir(platform.paths.dirname(path));
    await platform.fs.writeBytes(path, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  }
  const zipPath = `${workDir}/out.tpr`;
  await platform.zip.createFromDir(workDir, zipPath, { order: ['manifest.json'] });
  return { bytes: await platform.fs.readBytes(zipPath), markdown };
}

const bodyOf = (db: RawDatabase): string =>
  JSON.stringify({
    authors: db.authors,
    tags: db.tags,
    images: db.images,
    articles: db.articles,
    series: db.series,
    featured: db.featured,
    credits: db.credits,
  });

describe('library: 导入 / 持久化 / 导出 round-trip', () => {
  it('import-snapshot: 导入后 snapshot 可用、计数正确、警告为空', async () => {
    const db = makeDatabase();
    const { bytes } = await packDatabase(db, '/seed');
    const platform = createMemoryPlatform({ dataDir: '/app' });
    const library = createLibrary(platform);

    const outcome = await library.importBytes(bytes);
    expect(outcome.report.ok).toBe(true);
    expect(outcome.report.errors).toEqual([]);
    expect(outcome.snapshot.manifest.databaseId).toBe(db.manifest.databaseId);
    expect(outcome.snapshot.articles.length).toBe(db.articles.length);
    expect(outcome.snapshot.manifest.counts.articles).toBe(db.articles.length);
  });

  it('import-restart: 重新建库对象后 restore() 仍能读回同一份数据', async () => {
    const db = makeDatabase();
    const { bytes } = await packDatabase(db, '/seed');
    const platform = createMemoryPlatform({ dataDir: '/app' });

    await createLibrary(platform).importBytes(bytes);
    const restored = await createLibrary(platform).restore();

    expect(restored).not.toBeNull();
    expect(restored?.articles.length).toBe(db.articles.length);
    expect(restored?.manifest.databaseId).toBe(db.manifest.databaseId);
  });

  it('import-content: 正文按需读取，内容与包内一致', async () => {
    const db = makeDatabase();
    const { bytes, markdown } = await packDatabase(db, '/seed');
    const platform = createMemoryPlatform({ dataDir: '/app' });
    const library = createLibrary(platform);
    await library.importBytes(bytes);

    for (const article of db.articles) {
      await expect(library.readContent(article.id)).resolves.toBe(markdown.get(article.id));
    }
  });

  it('import-reject: 校验失败时抛 ImportError，不覆盖已有库', async () => {
    const broken = makeDatabase();
    // 重复 id 是 error 级问题（E_DUPLICATE_ID）
    const { bytes } = await packDatabase(
      { ...broken, authors: [...broken.authors, ...broken.authors] },
      '/seed',
    );
    const platform = createMemoryPlatform({ dataDir: '/app' });
    const library = createLibrary(platform);

    await expect(library.importBytes(bytes)).rejects.toMatchObject({ name: 'ImportError' });
    expect(library.current()).toBeNull();
  });

  it('export-roundtrip: 导出全库再导入，实体逐字段相等', async () => {
    const db = makeDatabase();
    const { bytes } = await packDatabase(db, '/seed');

    const platformA = createMemoryPlatform({ dataDir: '/appA' });
    const libraryA = createLibrary(platformA);
    await libraryA.importBytes(bytes);

    const exported = await libraryA.export({ all: true });
    expect(exported.warnings).toEqual([]);
    expect(exported.fileName.endsWith('.tpr')).toBe(true);
    expect(exported.counts.articles).toBe(db.articles.length);

    const platformB = createMemoryPlatform({ dataDir: '/appB' });
    const libraryB = createLibrary(platformB);
    await libraryB.importBytes(exported.bytes);

    const a = libraryA.current();
    const b = libraryB.current();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(bodyOf(b?.db as RawDatabase)).toBe(bodyOf(a?.db as RawDatabase));
  });

  it('export-subset: 只导出一篇时系列不随包，作者/标签按引用裁剪', async () => {
    const db = makeDatabase();
    const { bytes } = await packDatabase(db, '/seed');
    const platform = createMemoryPlatform({ dataDir: '/app' });
    const library = createLibrary(platform);
    await library.importBytes(bytes);

    const short = db.articles.find((a) => a.type === 'short');
    const exported = await library.export({ articles: [short?.id ?? ''] });
    const platformB = createMemoryPlatform({ dataDir: '/appB' });
    const outcome = await createLibrary(platformB).importBytes(exported.bytes);

    expect(outcome.snapshot.articles.length).toBe(1);
    expect(outcome.snapshot.series.length).toBe(0);
    expect(outcome.report.warnings.some((w) => w.code === 'W_DANGLING_SERIES')).toBe(false);
  });
});
