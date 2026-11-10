import { createMemoryPlatform } from '@tpr/platform/memory';
import type { RawDatabase } from '@tpr/schema';
import { makeDatabase } from '@tpr/schema/testing';
import { describe, expect, it } from 'vitest';
import { createLibrary, type Library } from '../src/db/library.js';
import { ioFor } from '../src/db/workspace.js';
import { serializeDatabase, writeDatabaseDir } from '../src/db/write.js';
import { createEditor, type Editor } from '../src/editor/index.js';

async function openDatabase(source: RawDatabase = makeDatabase()): Promise<{
  library: Library;
  editor: Editor;
  db: RawDatabase;
}> {
  const db = source;
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
  return { library, editor: createEditor(platform, library), db };
}

/** 打开 makeDatabase() 那个库（1 作者 / 1 封面 / 系列 2 篇 / 1 短篇），并给出常用 id。 */
async function openFixture() {
  const db = makeDatabase();
  const opened = await openDatabase(db);
  return { ...opened, authorId: db.authors[0]!.id, imageId: db.images[0]!.id };
}

describe('series meta sync: 继承填空', () => {
  it('saveSeries 保存并读回 autoFillFields；未传时保留原值；传空数组时清空', async () => {
    const { library, editor } = await openDatabase();
    const draft = {
      title: '带策略的系列',
      summary: '',
      status: 'ongoing' as const,
      articleIds: [],
      authorIds: [],
      translatorIds: [],
      characterTagIds: [],
      plotTagIds: [],
    };
    const readBack = (id: string) =>
      library.snapshot()?.series.find((series) => series.id === id)?.autoFillFields;

    const id = await editor.saveSeries({ ...draft, autoFillFields: ['author', 'cover'] });
    expect(readBack(id)).toEqual(['author', 'cover']);

    // 不传这个键：保留原值（不能因为表单没带就把策略清空）。
    await editor.saveSeries({ ...draft, id });
    expect(readBack(id)).toEqual(['author', 'cover']);

    await editor.saveSeries({ ...draft, id, autoFillFields: [] });
    expect(readBack(id)).toEqual([]);
  });

  it('文章新进入系列时按策略补空字段，不覆盖已有值，策略外的字段不动', async () => {
    const { db, library, editor, authorId, imageId } = await openFixture();
    const shortArticle = db.articles.find((article) => article.type === 'short')!;
    const seriesId = await editor.saveSeries({
      title: '策略系列',
      summary: '',
      status: 'ongoing',
      articleIds: [],
      authorIds: [authorId],
      translatorIds: [authorId],
      characterTagIds: [],
      plotTagIds: [],
      coverImageId: imageId,
      autoFillFields: ['author', 'cover'],
    });

    // 短篇原本有作者（同一个），作者保持不变；封面为空 → 补上；译者不在策略里 → 不动。
    await editor.saveArticle({
      id: shortArticle.id,
      type: 'short',
      title: shortArticle.title,
      summary: '',
      authorIds: [authorId],
      translatorIds: [],
      characterTagIds: [],
      plotTagIds: [],
      illustrationImageIds: [],
      seriesId,
    });

    const saved = library.snapshot()?.articles.find((article) => article.id === shortArticle.id);
    expect(saved?.authorIds).toEqual([authorId]);
    expect(saved?.coverImageId).toBe(imageId);
    expect(saved?.translatorIds).toEqual([]);
    expect(saved?.type).toBe('series-entry');
  });

  it('已在系列里的老文章不会因为再次保存系列而被自动改', async () => {
    const { db, library, editor, authorId } = await openFixture();
    const series = db.series[0]!;
    const entry = db.articles.find((article) => article.seriesId === series.id)!;
    await editor.saveSeries({
      id: series.id,
      title: series.title,
      summary: series.summary,
      status: series.status,
      articleIds: series.articleIds,
      authorIds: series.authorIds,
      translatorIds: [authorId],
      characterTagIds: [],
      plotTagIds: [],
      autoFillFields: ['translator'],
    });

    const saved = library.snapshot()?.articles.find((article) => article.id === entry.id);
    expect(saved?.translatorIds).toEqual(entry.translatorIds);
  });
});

describe('series meta sync: 显式清单同步', () => {
  it('只改清单里的文章×字段，未列入的不动', async () => {
    const { db, library, editor, authorId } = await openFixture();
    const series = db.series[0]!;
    const target = series.articleIds[0]!;
    const other = series.articleIds[1]!;
    await editor.saveSeries({
      id: series.id,
      title: series.title,
      summary: series.summary,
      status: series.status,
      articleIds: series.articleIds,
      authorIds: series.authorIds,
      translatorIds: [authorId],
      characterTagIds: [],
      plotTagIds: [],
    });

    const changed = await editor.applySeriesMetaSync(series.id, [
      { articleId: target, field: 'translator' },
    ]);

    expect(changed).toBe(1);
    const snapshot = library.snapshot();
    expect(snapshot?.articles.find((a) => a.id === target)?.translatorIds).toEqual([authorId]);
    expect(snapshot?.articles.find((a) => a.id === other)?.translatorIds).toEqual([]);
  });

  it('系列该字段为空时整批跳过，文章一个字都不动', async () => {
    // 夹具里系列的 translatorIds 本来就是空的，文章也都还是「未填」状态。
    const { db, library, editor } = await openFixture();
    const series = db.series[0]!;
    const member = series.articleIds[0]!;
    const readArticle = (id: string) => library.snapshot()!.articles.find((a) => a.id === id)!;
    const before = readArticle(member);

    const changed = await editor.applySeriesMetaSync(series.id, [
      { articleId: member, field: 'translator' },
    ]);

    expect(changed).toBe(0);
    const after = readArticle(member);
    expect(after.translatorIds).toEqual([]);
    // 一列都没改：连 updatedAt 也不该被动过
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it('系列外的文章与不存在的 id 被跳过，只同步系列内那篇', async () => {
    // 系列译者必须非空，否则三项会先在「系列该字段为空」处短路，成员/存在性守卫就测不到。
    const source = makeDatabase();
    const series = source.series[0]!;
    const authorId = source.authors[0]!.id;
    series.translatorIds = [authorId];
    const { db, library, editor } = await openDatabase(source);
    const member = series.articleIds[0]!;
    const other = series.articleIds[1]!;
    const outsider = db.articles.find((article) => article.type === 'short')!;

    const changed = await editor.applySeriesMetaSync(series.id, [
      { articleId: outsider.id, field: 'translator' },
      { articleId: 'a_doesnotexist0000', field: 'translator' },
      { articleId: member, field: 'translator' },
    ]);

    expect(changed).toBe(1);
    const snapshot = library.snapshot()!;
    const readArticle = (id: string) => snapshot.articles.find((a) => a.id === id)!;
    expect(readArticle(member).translatorIds).toEqual([authorId]);
    expect(readArticle(other).translatorIds).toEqual([]);
    // 系列外的短篇一个字都不许动（连 updatedAt 也不动）
    expect(readArticle(outsider.id).translatorIds).toEqual([]);
    expect(readArticle(outsider.id).updatedAt).toBe(outsider.updatedAt);
    // 悬空 id 不该凭空补出一篇文章
    expect(snapshot.articles.some((article) => article.id === 'a_doesnotexist0000')).toBe(false);
  });

  it('同一批被改的文章共用一个 updatedAt；重放返回 0；空清单不进入编辑', async () => {
    const source = makeDatabase();
    const series = source.series[0]!;
    series.translatorIds = [source.authors[0]!.id];
    const { library, editor } = await openDatabase(source);
    const readArticle = (id: string) => library.snapshot()!.articles.find((a) => a.id === id)!;
    const before = new Map(series.articleIds.map((id) => [id, readArticle(id).updatedAt]));
    const items = series.articleIds.map((articleId) => ({
      articleId,
      field: 'translator' as const,
    }));

    expect(await editor.applySeriesMetaSync(series.id, items)).toBe(2);

    // 两篇都是这一次编辑改的：必须共用同一个 now() 时间戳，并且确实换了新值
    const [first, second] = series.articleIds.map((id) => readArticle(id));
    expect(first!.updatedAt).toBe(second!.updatedAt);
    expect(first!.updatedAt).not.toBe(before.get(series.articleIds[0]!));

    expect(await editor.applySeriesMetaSync(series.id, items)).toBe(0);
    // 空清单必须尽早返回：不白改 manifest.updatedAt、不白加 revision
    const revision = library.revision;
    expect(await editor.applySeriesMetaSync(series.id, [])).toBe(0);
    expect(library.revision).toBe(revision);
  });
});
