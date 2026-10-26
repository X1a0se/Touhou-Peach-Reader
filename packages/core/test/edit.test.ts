import { createMemoryPlatform } from '@tpr/platform/memory';
import type { RawDatabase } from '@tpr/schema';
import { makeDatabase, makeTag } from '@tpr/schema/testing';
import { describe, expect, it } from 'vitest';
import { readImageBlob } from '../src/db/sql/store.js';
import { ioFor } from '../src/db/workspace.js';
import { serializeDatabase, writeDatabaseDir } from '../src/db/write.js';
import { createLibrary, type Library } from '../src/db/library.js';
import { createEditor, type Editor } from '../src/editor/index.js';
import { getFeaturedCards } from '../src/db/featured.js';
import type { DBSnapshot } from '../src/db/snapshot.js';
import { articleSeriesPosition } from '../src/db/view.js';

async function openDatabase(source: RawDatabase = makeDatabase()): Promise<{
  platform: ReturnType<typeof createMemoryPlatform>;
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
      translatorIds: [],
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

  it('edit-series-translator: 系列可以保存译者并读回', async () => {
    const { library, editor } = await openDatabase();
    const translatorId = library.snapshot()?.authors[0]?.id ?? '';
    const seriesId = await editor.saveSeries({
      title: '有译者的系列',
      summary: '',
      status: 'ongoing',
      articleIds: [],
      authorIds: [],
      translatorIds: [translatorId],
      characterTagIds: [],
      plotTagIds: [],
    });

    const saved = library.snapshot()?.series.find((series) => series.id === seriesId);
    expect(saved?.translatorIds).toEqual([translatorId]);
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

  it('edit-image: 上传图片写 BLOB，改 kind 时更新元数据，删除时清理数据与引用', async () => {
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
    expect(await readImageBlob(platform, dir, imageId)).toEqual(new Uint8Array([1, 2, 3, 4]));

    await editor.updateImage(imageId, { kind: 'illustration', caption: '改过的配文' });
    const moved = library.snapshot()?.images.find((item) => item.id === imageId);
    expect(moved?.file).toContain('/illustration/');
    expect(await readImageBlob(platform, dir, imageId)).toEqual(new Uint8Array([1, 2, 3, 4]));

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
      ...(article.seriesId ? { seriesId: article.seriesId } : {}),
      coverImageId: imageId,
      illustrationImageIds: [],
    });
    await editor.deleteImage(imageId);
    expect(library.snapshot()?.images.some((item) => item.id === imageId)).toBe(false);
    expect(await readImageBlob(platform, dir, imageId)).toBeNull();
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

  it('edit-article-series-append: 新建文章选系列后追加到目录末尾并成为 series-entry', async () => {
    const { library, editor } = await openDatabase();
    const series = library.snapshot()?.series[0];
    expect(series).toBeTruthy();
    if (!series) return;
    const before = series.articleIds.length;

    const id = await editor.saveArticle({
      type: 'series-entry',
      seriesId: series.id,
      title: '追加的条目',
      summary: '',
      content: '# 追加的条目\n',
      authorIds: [],
      translatorIds: [],
      characterTagIds: [],
      plotTagIds: [],
      illustrationImageIds: [],
    });

    const after = library.snapshot()?.series[0]?.articleIds ?? [];
    expect(after).toEqual([...series.articleIds, id]);
    expect(after).toHaveLength(before + 1);
    expect(library.snapshot()?.articles.find((article) => article.id === id)?.type).toBe('series-entry');
    expect(articleSeriesPosition(library.snapshot() as DBSnapshot, id)?.index).toBe(before + 1);
  });

  it('edit-article-series-keep: 已属系列的文章改元数据时保持原位置', async () => {
    const { library, editor } = await openDatabase();
    const series = library.snapshot()?.series[0];
    const second = series?.articleIds[1];
    expect(second).toBeTruthy();
    if (!series || !second) return;
    const before = [...series.articleIds];

    await editor.saveArticle({
      id: second,
      type: 'series-entry',
      seriesId: series.id,
      title: '只改标题',
      summary: '只改简介',
      authorIds: [],
      translatorIds: [],
      characterTagIds: [],
      plotTagIds: [],
      illustrationImageIds: [],
    });

    expect(library.snapshot()?.series[0]?.articleIds).toEqual(before);
    expect(library.snapshot()?.articles.find((article) => article.id === second)?.title).toBe('只改标题');
  });

  it('edit-article-series-move: 换系列时从原目录移出、追加到新目录末尾', async () => {
    const { library, editor } = await openDatabase();
    const source = library.snapshot()?.series[0];
    const articleId = source?.articleIds[0];
    expect(source && articleId).toBeTruthy();
    if (!source || !articleId) return;

    const targetId = await editor.saveSeries({
      title: '目标系列',
      summary: '',
      status: 'ongoing',
      articleIds: [],
      authorIds: [],
      translatorIds: [],
      characterTagIds: [],
      plotTagIds: [],
    });

    await editor.saveArticle({
      id: articleId,
      type: 'series-entry',
      seriesId: targetId,
      title: '搬到另一个系列',
      summary: '',
      authorIds: [],
      translatorIds: [],
      characterTagIds: [],
      plotTagIds: [],
      illustrationImageIds: [],
    });

    const snapshot = library.snapshot();
    expect(snapshot?.series.find((series) => series.id === source.id)?.articleIds).not.toContain(articleId);
    expect(snapshot?.series.find((series) => series.id === targetId)?.articleIds).toEqual([articleId]);
    expect(articleSeriesPosition(snapshot as DBSnapshot, articleId)?.series.id).toBe(targetId);
  });

  it('edit-article-series-clear: 清空系列后降级为短篇并从目录移除', async () => {
    const { library, editor } = await openDatabase();
    const series = library.snapshot()?.series[0];
    const articleId = series?.articleIds[0];
    expect(articleId).toBeTruthy();
    if (!series || !articleId) return;

    await editor.saveArticle({
      type: 'short',
      id: articleId,
      title: '退出系列',
      summary: '',
      authorIds: [],
      translatorIds: [],
      characterTagIds: [],
      plotTagIds: [],
      illustrationImageIds: [],
    });

    const snapshot = library.snapshot();
    expect(snapshot?.series.find((item) => item.id === series.id)?.articleIds).not.toContain(articleId);
    const article = snapshot?.articles.find((item) => item.id === articleId);
    expect(article?.type).toBe('short');
    expect(article?.seriesId).toBeUndefined();
  });

  it('edit-article-series-guard: 没有系列却声明 series-entry 时拒绝', async () => {
    const { editor } = await openDatabase();
    await expect(
      editor.saveArticle({
        type: 'series-entry',
        title: '没有系列',
        summary: '',
        authorIds: [],
        translatorIds: [],
        characterTagIds: [],
        plotTagIds: [],
        illustrationImageIds: [],
      }),
    ).rejects.toThrow('系列条目必须放在一个系列里');
  });

  it('edit-series-order: 目录顺序按传入数组保存，未知文章被校验拦下', async () => {
    const { library, editor } = await openDatabase();
    const series = library.snapshot()?.series[0];
    expect(series?.articleIds.length).toBeGreaterThan(1);
    if (!series) return;
    const reversed = [...series.articleIds].reverse();

    await editor.saveSeries({
      id: series.id,
      title: series.title,
      summary: series.summary,
      status: series.status,
      articleIds: reversed,
      authorIds: series.authorIds,
      translatorIds: series.translatorIds,
      characterTagIds: series.characterTagIds,
      plotTagIds: series.plotTagIds,
    });
    expect(library.snapshot()?.series[0]?.articleIds).toEqual(reversed);

    await expect(
      editor.saveSeries({
        id: series.id,
        title: series.title,
        summary: series.summary,
        status: series.status,
        articleIds: [...reversed, 'a_ffffffffffffffff'],
        authorIds: series.authorIds,
        translatorIds: series.translatorIds,
        characterTagIds: series.characterTagIds,
        plotTagIds: series.plotTagIds,
      }),
    ).rejects.toThrow('E_SERIES_ORDER');
  });
});

describe('editor: 合并标签', () => {
  function mergeFixture() {
    const db = makeDatabase();
    const target = db.tags.find((tag) => tag.category === 'character');
    expect(target).toBeTruthy();
    if (!target) throw new Error('夹具缺少角色标签');
    const sourceA = makeTag({ category: 'character', name: '魔理沙', aliases: ['Marisa'] });
    const sourceB = makeTag({ category: 'character', name: '黑白' });
    db.tags = [...db.tags, sourceA, sourceB];

    const article = db.articles.find((item) => item.title === '系列第一篇');
    const series = db.series[0];
    const short = db.articles.find((item) => item.type === 'short');
    expect(article && series && short).toBeTruthy();
    if (!article || !series || !short) throw new Error('夹具缺文章或系列');

    article.characterTagIds = [...article.characterTagIds, sourceA.id, sourceB.id];
    series.characterTagIds = [...series.characterTagIds, sourceA.id];
    short.characterTagIds = [sourceB.id];
    return { db, target, sourceA, sourceB, articleId: article.id, seriesId: series.id, shortId: short.id };
  }

  it('merge-tags-batch: 批量合并同类别标签，别名与引用都落到目标标签并持久化', async () => {
    const fixture = mergeFixture();
    const beforeArticle = fixture.db.articles.find((item) => item.id === fixture.articleId);
    const beforeUpdatedAt = beforeArticle?.updatedAt;
    const { platform, library, editor } = await openDatabase(fixture.db);

    await editor.mergeTags([fixture.sourceA.id, fixture.sourceB.id], fixture.target.id);

    const snapshot = library.snapshot();
    expect(snapshot).toBeTruthy();
    if (!snapshot) return;

    expect(
      snapshot.tags.some((tag) => tag.id === fixture.sourceA.id || tag.id === fixture.sourceB.id),
    ).toBe(false);
    const target = snapshot.tags.find((tag) => tag.id === fixture.target.id);
    expect(target?.name).toBe(fixture.target.name);
    expect(target?.aliases).toEqual(expect.arrayContaining(['魔理沙', 'Marisa', '黑白']));

    const article = snapshot.articles.find((item) => item.id === fixture.articleId);
    expect(article?.characterTagIds.filter((id) => id === fixture.target.id)).toHaveLength(1);
    expect(article?.characterTagIds).not.toContain(fixture.sourceA.id);
    expect(article?.characterTagIds).not.toContain(fixture.sourceB.id);
    expect(article?.updatedAt).toBe(beforeUpdatedAt);

    const series = snapshot.series.find((item) => item.id === fixture.seriesId);
    expect(series?.characterTagIds).toContain(fixture.target.id);
    expect(series?.characterTagIds).not.toContain(fixture.sourceA.id);

    const short = snapshot.articles.find((item) => item.id === fixture.shortId);
    expect(short?.characterTagIds).toEqual([fixture.target.id]);

    const restored = createLibrary(platform);
    await restored.restore();
    const restoredTarget = restored.snapshot()?.tags.find((tag) => tag.id === fixture.target.id);
    expect(restoredTarget?.aliases).toEqual(expect.arrayContaining(['魔理沙', 'Marisa', '黑白']));
    const restoredShort = restored.snapshot()?.articles.find((item) => item.id === fixture.shortId);
    expect(restoredShort?.characterTagIds).toEqual([fixture.target.id]);
  });

  it('merge-tags-category-field: 源引用在错误数组里时归位到目标类别数组', async () => {
    const db = makeDatabase();
    const target = db.tags.find((tag) => tag.category === 'character');
    const source = makeTag({ category: 'character', name: '黑白' });
    expect(target).toBeTruthy();
    if (!target) return;
    db.tags = [...db.tags, source];

    const article = db.articles.find((item) => item.title === '系列第一篇');
    expect(article).toBeTruthy();
    if (!article) return;
    article.plotTagIds = [...article.plotTagIds, source.id];

    const { library, editor } = await openDatabase(db);
    await editor.mergeTags([source.id], target.id);

    const saved = library.snapshot()?.articles.find((item) => item.id === article.id);
    expect(saved?.characterTagIds).toContain(target.id);
    expect(saved?.plotTagIds).not.toContain(target.id);
    expect(saved?.plotTagIds).not.toContain(source.id);
  });

  it('merge-tags-general: 通用标签可合并；仍被引用时拒绝且库不变', async () => {
    const db = makeDatabase();
    const source = makeTag({ category: 'general', name: '日常' });
    const target = makeTag({ category: 'general', name: '轻松', aliases: ['治愈'] });
    db.tags = [...db.tags, source, target];

    const first = await openDatabase(db);
    await first.editor.mergeTags([source.id], target.id);
    const merged = first.library.snapshot()?.tags ?? [];
    expect(merged.some((tag) => tag.id === source.id)).toBe(false);
    expect(merged.find((tag) => tag.id === target.id)?.aliases).toEqual(
      expect.arrayContaining(['日常', '治愈']),
    );

    const db2 = makeDatabase();
    const source2 = makeTag({ category: 'general', name: '日常' });
    const target2 = makeTag({ category: 'general', name: '轻松' });
    db2.tags = [...db2.tags, source2, target2];
    const article = db2.articles[0];
    expect(article).toBeTruthy();
    if (!article) return;
    article.characterTagIds = [...article.characterTagIds, source2.id];

    const second = await openDatabase(db2);
    await expect(second.editor.mergeTags([source2.id], target2.id)).rejects.toThrow(
      '该标签仍被文章或系列引用，不能合并到系列/通用标签',
    );
    expect(second.library.snapshot()?.tags.some((tag) => tag.id === source2.id)).toBe(true);
  });

  it('merge-tags-validation: 空源/自合并/源或目标不存在/跨类别都拒绝且库不变', async () => {
    const db = makeDatabase();
    const { library, editor } = await openDatabase(db);
    const character = db.tags.find((tag) => tag.category === 'character');
    const plot = db.tags.find((tag) => tag.category === 'plot');
    expect(character && plot).toBeTruthy();
    if (!character || !plot) return;
    const before = library.snapshot()?.tags.length ?? 0;

    await expect(editor.mergeTags([], character.id)).rejects.toThrow('请选择要合并的标签');
    await expect(editor.mergeTags([character.id], character.id)).rejects.toThrow(
      '不能把标签合并到自身',
    );
    await expect(editor.mergeTags(['t_ffffffffffffffff'], character.id)).rejects.toThrow(
      '要合并的标签不存在',
    );
    await expect(editor.mergeTags([plot.id], character.id)).rejects.toThrow(
      '只能合并同一类别的标签',
    );
    await expect(editor.mergeTags([character.id], 't_ffffffffffffffff')).rejects.toThrow(
      '标签 t_ffffffffffffffff 不存在',
    );
    expect(library.snapshot()?.tags.length).toBe(before);
  });
});
