import { createMemoryPlatform } from '@tpr/platform/memory';
import type { RawDatabase } from '@tpr/schema';
import { makeDatabase } from '@tpr/schema/testing';
import { describe, expect, it } from 'vitest';
import { ioFor } from '../src/db/workspace.js';
import { serializeDatabase, writeDatabaseDir } from '../src/db/write.js';
import { createLibrary, type Library } from '../src/db/library.js';
import { createEditor, type Editor } from '../src/editor/index.js';
import { getFeaturedCards } from '../src/db/featured.js';

async function openDatabase(): Promise<{
  platform: ReturnType<typeof createMemoryPlatform>;
  library: Library;
  editor: Editor;
  db: RawDatabase;
}> {
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

describe('editor: 全实体 CRUD（Goal 9）', () => {
  it('edit-article: 新建/编辑文章正文与元数据，重启后仍在', async () => {
    const { platform, library, editor } = await openDatabase();
    const before = library.snapshot()?.articles.length ?? 0;
    const authorId = library.snapshot()?.authors[0]?.id ?? '';

    const id = await editor.saveArticle({
      type: 'short',
      title: '新写的短篇',
      summary: '一句话简介',
      content: '# 新写的短篇\n\n这是正文。\n',
      authorIds: [authorId],
      translatorIds: [],
      characterTagIds: [],
      plotTagIds: [],
      illustrationImageIds: [],
      sourceUrl: 'https://example.com/new',
    });

    const article = library.snapshot()?.articles.find((item) => item.id === id);
    expect(article?.title).toBe('新写的短篇');
    expect(article?.sourceUrl).toBe('https://example.com/new');
    expect(library.snapshot()?.articles.length).toBe(before + 1);
    expect(await library.readContent(id)).toContain('这是正文。');

    await editor.saveArticle({
      id,
      type: 'short',
      title: '改过的标题',
      summary: '一句话简介',
      content: '改过的正文',
      authorIds: [authorId],
      translatorIds: [],
      characterTagIds: [],
      plotTagIds: [],
      illustrationImageIds: [],
    });

    const restored = createLibrary(platform);
    await restored.restore();
    const saved = restored.snapshot()?.articles.find((item) => item.id === id);
    expect(saved?.title).toBe('改过的标题');
    expect(await restored.readContent(id)).toBe('改过的正文');
  });

  it('edit-alias-reuse: 用已有别名新建作者时复用原作者，不产生新作者', async () => {
    const { library, editor } = await openDatabase();
    const author = library.snapshot()?.authors[0];
    expect(author).toBeTruthy();
    await editor.saveAuthor({ canonicalName: '雾雨魔理沙', aliases: ['Marisa', '魔理沙'] });

    const id = await editor.saveAuthor({ canonicalName: 'marisa', aliases: [] });
    expect(id).toBe(author?.id);
    expect(library.snapshot()?.authors.length).toBe(1);
  });

  it('edit-tag: 同类别同名/别名复用，重复类别分开', async () => {
    const { library, editor } = await openDatabase();
    const before = library.snapshot()?.tags.length ?? 0;

    const id = await editor.saveTag({ category: 'character', name: '雾雨魔理沙', aliases: ['黑白'] });
    expect(id).toBe(library.snapshot()?.tags.find((tag) => tag.name === '雾雨魔理沙')?.id);

    const aliasId = await editor.saveTag({ category: 'character', name: '黑白' });
    expect(aliasId).toBe(id);

    const plotId = await editor.saveTag({ category: 'plot', name: '黑白' });
    expect(plotId).not.toBe(id);
    expect(library.snapshot()?.tags.length).toBe(before + 1);
  });

  it('edit-series: 保存系列时双向同步文章 seriesId/type，删除后文章降级为 short', async () => {
    const { library, editor } = await openDatabase();
    const shortArticle = library.snapshot()?.articles.find((article) => article.type === 'short');
    expect(shortArticle).toBeTruthy();
    const seriesId = await editor.saveSeries({
      title: '新系列',
      summary: '新系列简介',
      status: 'ongoing',
      articleIds: [shortArticle?.id ?? ''],
      authorIds: [],
      characterTagIds: [],
      plotTagIds: [],
    });

    const entry = library.snapshot()?.articles.find((article) => article.id === shortArticle?.id);
    expect(entry?.type).toBe('series-entry');
    expect(entry?.seriesId).toBe(seriesId);

    await editor.deleteSeries(seriesId);
    const demoted = library.snapshot()?.articles.find((article) => article.id === shortArticle?.id);
    expect(demoted?.type).toBe('short');
    expect(demoted?.seriesId).toBeUndefined();
  });

  it('edit-cascade: 删除文章同时从系列目录与精选里移除', async () => {
    const { library, editor } = await openDatabase();
    const series = library.snapshot()?.series[0];
    const articleId = series?.articleIds[0];
    expect(articleId).toBeTruthy();
    await editor.saveFeatured('article', articleId ?? '', [{ author: '某人', text: '推荐。' }]);

    await editor.deleteArticle(articleId ?? '');

    expect(library.snapshot()?.articles.some((article) => article.id === articleId)).toBe(false);
    expect(library.snapshot()?.series[0]?.articleIds).not.toContain(articleId);
    expect(library.snapshot()?.featured.some((entry) => entry.targetId === articleId)).toBe(false);
  });

  it('edit-image: 上传图片写文件，改 kind 时移动文件，删除时清理引用', async () => {
    const { platform, library, editor } = await openDatabase();
    const article = library.snapshot()?.articles[0];
    const imageId = await editor.saveImage({
      bytes: new Uint8Array([1, 2, 3, 4]),
      ext: 'png',
      kind: 'cover',
      caption: '封面配文',
    });

    const image = library.snapshot()?.images.find((item) => item.id === imageId);
    expect(image?.caption).toBe('封面配文');
    const dir = library.current()?.dir ?? '';
    expect(await platform.fs.exists(platform.paths.join(dir, image?.file ?? ''))).toBe(true);

    await editor.updateImage(imageId, { kind: 'illustration', caption: '改过的配文' });
    const moved = library.snapshot()?.images.find((item) => item.id === imageId);
    expect(moved?.file).toContain('/illustration/');
    expect(await platform.fs.exists(platform.paths.join(dir, moved?.file ?? ''))).toBe(true);
    expect(await platform.fs.exists(platform.paths.join(dir, image?.file ?? ''))).toBe(false);

    if (!article) throw new Error('夹具缺少文章');
    await editor.saveArticle({
      id: article.id,
      type: article.type,
      title: article?.title ?? '',
      summary: article?.summary ?? '',
      authorIds: article?.authorIds ?? [],
      translatorIds: article?.translatorIds ?? [],
      characterTagIds: article?.characterTagIds ?? [],
      plotTagIds: article?.plotTagIds ?? [],
      coverImageId: imageId,
      illustrationImageIds: [],
    });
    await editor.deleteImage(imageId);
    expect(library.snapshot()?.images.some((item) => item.id === imageId)).toBe(false);
    expect(await platform.fs.exists(platform.paths.join(dir, moved?.file ?? ''))).toBe(false);
    expect(library.snapshot()?.articles[0]?.coverImageId).toBeUndefined();
  });

  it('edit-featured-credits: 推荐语 upsert 与鸣谢保序', async () => {
    const { library, editor } = await openDatabase();
    const article = library.snapshot()?.articles[0];
    await editor.saveFeatured('article', article?.id ?? '', [
      { author: '甲', text: '第一条' },
      { text: '第二条' },
    ]);
    await editor.saveFeatured('article', article?.id ?? '', [{ text: '只有一条' }]);

    const entries = library.snapshot()?.featured.filter((entry) => entry.targetId === article?.id);
    expect(entries).toHaveLength(1);
    expect(entries?.[0]?.recommendations).toHaveLength(1);

    const cards = getFeaturedCards(library.snapshot() as never, { dir: '', join: (...parts: string[]) => parts.join('/') }, 'short');
    expect(cards.some((card) => card.targetId === article?.id)).toBe(true);

    await editor.saveCredits([{ name: '丙' }, { name: '乙', role: '校对' }, { name: '甲' }]);
    expect(library.snapshot()?.credits.map((entry) => entry.name)).toEqual(['丙', '乙', '甲']);
  });

  it('edit-validation: 空标题与校验失败拒绝落盘', async () => {
    const { editor } = await openDatabase();
    await expect(
      editor.saveArticle({
        type: 'short',
        title: '   ',
        summary: '',
        authorIds: [],
        translatorIds: [],
        characterTagIds: [],
        plotTagIds: [],
        illustrationImageIds: [],
      }),
    ).rejects.toThrow('文章标题不能为空');
  });
});
