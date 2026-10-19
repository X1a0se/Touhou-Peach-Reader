import { createMemoryPlatform } from '@tpr/platform/memory';
import type { RawDatabase } from '@tpr/schema';
import { makeDatabase } from '@tpr/schema/testing';
import { describe, expect, it } from 'vitest';
import { createLibrary, type Library } from '../src/db/library.js';
import { ioFor } from '../src/db/workspace.js';
import { serializeDatabase, writeDatabaseDir } from '../src/db/write.js';
import { createEditor, type Editor } from '../src/editor/index.js';

/**
 * 导出保真（Goal 19）。
 *
 * 用户的问题：「导出的数据库真的是程序内修改后版本吗？」
 * 这里用内存平台走完整链路——导入夹具 → 编辑器改标题/正文/标签/系列顺序/封面 →
 * 删除一篇 → 导出 → 解包 → 再导入，逐项断言导出物就是修改后的状态。
 */

type MemoryPlatform = ReturnType<typeof createMemoryPlatform>;
type Packed = { platform: MemoryPlatform; library: Library; editor: Editor; db: RawDatabase };

async function openDatabase(): Promise<Packed> {
  const db = makeDatabase();
  const seed = createMemoryPlatform({ dataDir: '/seed' });
  const io = ioFor(seed);
  const markdown = new Map(db.articles.map((article) => [article.id, `# ${article.title}\n\n正文：${article.id}\n`]));
  await writeDatabaseDir(io, '/seed', serializeDatabase(db, markdown));
  for (const image of db.images) {
    const path = seed.paths.join('/seed', image.file);
    await seed.fs.mkdir(seed.paths.dirname(path));
    await seed.fs.writeBytes(path, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]));
  }
  await seed.zip.createFromDir('/seed', '/seed/out.tpr', { order: ['manifest.json'] });
  const bytes = await seed.fs.readBytes('/seed/out.tpr');

  const platform = createMemoryPlatform({ dataDir: '/app' });
  const library = createLibrary(platform);
  await library.importBytes(bytes);
  return { platform, library, editor: createEditor(platform, library), db };
}

/** 解包导出的字节，返回「包内相对路径 → 文本」；二进制文件用 latin1 占位。 */
async function unpack(platform: MemoryPlatform, bytes: Uint8Array, dir: string): Promise<Map<string, string>> {
  const zipPath = `${dir}.tpr`;
  await platform.fs.mkdir(dir);
  await platform.fs.writeBytes(zipPath, bytes);
  const result = await platform.zip.extractAll(zipPath, dir);
  expect(result.rejected).toEqual([]);

  const files = new Map<string, string>();
  const walk = async (current: string): Promise<void> => {
    for (const entry of await platform.fs.listDir(current)) {
      if (entry.isDirectory) {
        await walk(entry.path);
        continue;
      }
      const relative = entry.path.slice(dir.length + 1).replaceAll('\\', '/');
      const isText = /\.(json|md)$/.test(relative);
      files.set(relative, isText ? await platform.fs.readText(entry.path) : 'binary');
    }
  };
  await walk(dir);
  return files;
}

function parseJson<T>(files: Map<string, string>, path: string): T {
  const text = files.get(path);
  if (text === undefined) throw new Error(`导出包缺少 ${path}`);
  return JSON.parse(text) as T;
}

describe('export: 导出物必须是编辑后的状态（Goal 19）', () => {
  it('export-after-edit: 标题/正文/标签/系列顺序/封面都进包', async () => {
    const { platform, library, editor, db } = await openDatabase();
    const before = library.snapshot();
    if (!before) throw new Error('导入失败');

    const entry = before.articles.find((article) => article.type === 'series-entry');
    const series = before.series[0];
    const short = before.articles.find((article) => article.type === 'short');
    if (!entry || !series || !short) throw new Error('夹具结构不符合预期');

    const authorId = before.authors[0]?.id ?? '';
    const characterTag = before.tags.find((tag) => tag.category === 'character');
    const plotTag = before.tags.find((tag) => tag.category === 'plot');
    if (!characterTag || !plotTag) throw new Error('夹具缺少标签');

    const coverId = await editor.saveImage({
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]),
      ext: 'png',
      kind: 'cover',
      caption: '导出保真封面',
    });

    const newContent = '# 改过的标题\n\n这是编辑后的正文，必须出现在导出包里。\n';
    await editor.saveArticle({
      id: short.id,
      type: 'short',
      title: '改过的标题',
      summary: '改过的简介',
      content: newContent,
      authorIds: [authorId],
      translatorIds: [],
      characterTagIds: [characterTag.id],
      plotTagIds: [plotTag.id],
      illustrationImageIds: [],
      coverImageId: coverId,
    });

    // 调换系列目录顺序：把第二篇挪到最前
    const reversed = [...series.articleIds].reverse();
    await editor.saveSeries({
      id: series.id,
      title: series.title,
      summary: series.summary,
      status: series.status,
      articleIds: reversed,
      authorIds: series.authorIds,
      translatorIds: series.translatorIds ?? [],
      characterTagIds: series.characterTagIds,
      plotTagIds: series.plotTagIds,
    });

    const exported = await library.export({ all: true });
    const files = await unpack(platform, exported.bytes, '/unpack/first');

    const articleJson = parseJson<{ title: string; summary: string; characterTagIds: string[]; coverImageId?: string }>(
      files,
      `articles/${short.id}.json`,
    );
    expect(articleJson.title).toBe('改过的标题');
    expect(articleJson.summary).toBe('改过的简介');
    expect(articleJson.characterTagIds).toEqual([characterTag.id]);
    expect(articleJson.coverImageId).toBe(coverId);
    expect(files.get(`articles/${short.id}.md`)).toContain('编辑后的正文');
    expect(files.get(`articles/${short.id}.md`)).toBe(newContent);

    const seriesJson = parseJson<{ articleIds: string[] }>(files, `series/${series.id}.json`);
    expect(seriesJson.articleIds).toEqual(reversed);
    expect(files.has(`images/cover/${coverId}.png`)).toBe(true);

    const manifest = parseJson<{ counts: Record<string, number>; updatedAt: string }>(files, 'manifest.json');
    expect(manifest.counts['articles']).toBe(exported.counts.articles);
    expect(manifest.counts['articles']).toBe(library.snapshot()?.articles.length);
    expect(manifest.updatedAt).not.toBe(db.manifest.updatedAt);

    // 再导入一次：除 manifest.updatedAt 外，实体与当前库逐字段相等
    const fresh = createLibrary(createMemoryPlatform({ dataDir: '/fresh' }));
    const reimported = await fresh.importBytes(exported.bytes);
    const stable = (value: unknown): string =>
      JSON.stringify(value, (_key, item: unknown) => {
        if (item === null || typeof item !== 'object' || Array.isArray(item)) return item;
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(item).sort()) sorted[key] = (item as Record<string, unknown>)[key];
        return sorted;
      });
    const strip = (snapshot: typeof reimported.snapshot): string =>
      stable({
        authors: snapshot.authors,
        tags: snapshot.tags,
        images: snapshot.images,
        articles: snapshot.articles,
        series: snapshot.series,
        featured: snapshot.featured,
        credits: snapshot.credits,
      });
    const live = library.snapshot();
    if (!live) throw new Error('当前库不存在');
    expect(strip(reimported.snapshot)).toBe(strip(live));
  });

  it('export-after-delete: 删除的文章与独占图片不进包，系列目录同步清理', async () => {
    const { platform, library, editor } = await openDatabase();
    const before = library.snapshot();
    if (!before) throw new Error('导入失败');
    const entry = before.articles.find((article) => article.type === 'series-entry');
    const series = before.series[0];
    if (!entry || !series) throw new Error('夹具结构不符合预期');

    await editor.deleteArticle(entry.id);

    const exported = await library.export({ all: true });
    const files = await unpack(platform, exported.bytes, '/unpack/second');
    expect(files.has(`articles/${entry.id}.json`)).toBe(false);
    expect(files.has(`articles/${entry.id}.md`)).toBe(false);

    const seriesJson = parseJson<{ articleIds: string[] }>(files, `series/${series.id}.json`);
    expect(seriesJson.articleIds).not.toContain(entry.id);

    const manifest = parseJson<{ counts: Record<string, number> }>(files, 'manifest.json');
    expect(manifest.counts['articles']).toBe((before.articles.length ?? 0) - 1);
  });
});
