import { makeArticle, makeAuthor, makeDatabase, makeSeries, makeTag } from '@tpr/schema/testing';
import { createMemoryPlatform } from '@tpr/platform/memory';
import { describe, expect, it } from 'vitest';
import { createServices } from '../src/create.js';
import { createContentStore } from '../src/db/content-store.js';
import { normalizeDatabase } from '../src/db/normalize.js';
import { toSnapshot } from '../src/db/snapshot.js';
import { ioFor } from '../src/db/workspace.js';
import { serializeDatabase, writeDatabaseDir } from '../src/db/write.js';
import { buildSearchIndex } from '../src/search/build.js';
import { createSearchEngine } from '../src/search/engine.js';
import { parseQuery } from '../src/search/parse-query.js';
import { buildSnippets, flattenSnippet } from '../src/search/snippet.js';
import { bigramsOnly, tokenizeZh } from '../src/search/tokenize.js';

async function buildFixture() {
  const platform = createMemoryPlatform();
  const io = ioFor(platform);
  const dir = platform.paths.join(platform.paths.dataDir, 'workspace', 'db_test');
  await platform.fs.mkdir(dir);

  const author = makeAuthor({ canonicalName: '雾雨魔理沙', aliases: ['魔理沙', 'Marisa'] });
  const translator = makeAuthor({ canonicalName: '译者乙' });
  const character = makeTag({ category: 'character', name: '雾雨魔理沙', aliases: ['魔理沙'] });
  const plot = makeTag({ category: 'plot', name: '红魔馆' });
  const series = makeSeries({
    title: '红魔馆的日常',
    status: 'completed',
    authorIds: [author.id],
    translatorIds: [translator.id],
    characterTagIds: [character.id],
  });
  const entry = makeArticle({
    type: 'series-entry',
    seriesId: series.id,
    title: '第一篇 茶会',
    content: { file: 'articles/entry.md' },
    authorIds: [author.id],
    characterTagIds: [character.id],
    plotTagIds: [plot.id],
  });
  const short = makeArticle({
    type: 'short',
    title: '魔法使的午后',
    summary: '帕秋莉在图书馆里读书。',
    content: { file: 'articles/short.md' },
    authorIds: [author.id],
    characterTagIds: [character.id],
  });

  const raw = makeDatabase(
    {
      authors: [author, translator],
      tags: [character, plot],
      series: [{ ...series, articleIds: [entry.id] }],
      articles: [entry, short],
      featured: [],
      images: [],
      credits: [],
    },
    { withFiles: false },
  );

  const contents = createContentStore(io, dir);
  await contents.write(entry.id, '# 第一篇 茶会\n\n灵梦和魔理沙在红魔馆喝茶。\n');
  await contents.write(short.id, '# 魔法使的午后\n\n帕秋莉·诺蕾姬在图书馆里读魔导书。\n');

  const snapshot = toSnapshot(raw);
  const built = await buildSearchIndex(snapshot, { content: contents, chunk: 1 });
  return { snapshot, engine: built.engine, contents, short, entry, series, author, character };
}

describe('tokenizeZh', () => {
  it('中文整词 + 二元组，拉丁词保序去重', () => {
    const tokens = tokenizeZh('雾雨魔理沙 Marisa');
    expect(tokens).toContain('雾雨魔理沙');
    expect(tokens).toContain('魔理');
    expect(tokens).toContain('理沙');
    expect(tokens).toContain('marisa');
    expect(tokens.length).toBe(new Set(tokens).size);
  });

  it('bigramsOnly 只保留两字 CJK 词', () => {
    expect(bigramsOnly(tokenizeZh('雾雨魔理沙'))).toContain('魔理');
    expect(bigramsOnly(tokenizeZh('雾雨魔理沙'))).not.toContain('雾雨魔理沙');
  });
});

describe('parseQuery', () => {
  it('识别虚拟标签、标签名与短语', () => {
    const parsed = parseQuery('#已完结 魔理沙 #红魔馆 "茶会 午后"');
    expect(parsed.virtualTags).toContain('v:completed');
    expect(parsed.terms).toContain('魔理沙');
    expect(parsed.tagNames).toContain('红魔馆');
    expect(parsed.phrases).toEqual(['茶会 午后']);
  });
});

describe('search index', () => {
  it('标题命中', async () => {
    const { engine } = await buildFixture();
    const hits = engine.search('魔法使');
    expect(hits[0]?.kind).toBe('article');
  });

  it('正文命中', async () => {
    const { engine } = await buildFixture();
    const hits = engine.search('魔导书');
    expect(hits.some((hit) => hit.kind === 'article')).toBe(true);
  });

  it('摘要命中', async () => {
    const { engine } = await buildFixture();
    const hits = engine.search('图书馆');
    expect(hits.length).toBeGreaterThan(0);
  });

  it('作者别名命中（同一作者的另一个名字能搜到）', async () => {
    const { engine } = await buildFixture();
    const hits = engine.search('Marisa');
    expect(hits.some((hit) => hit.kind === 'author')).toBe(true);
    expect(hits.some((hit) => hit.kind === 'article')).toBe(true);
  });

  it('系列的译者名能搜到系列', async () => {
    const { engine } = await buildFixture();
    const hits = engine.search('译者乙');
    expect(hits.some((hit) => hit.kind === 'series')).toBe(true);
  });

  it('#已完结 命中系列与系列条目', async () => {
    const { engine } = await buildFixture();
    const hits = engine.search('#已完结');
    expect(hits.some((hit) => hit.kind === 'series')).toBe(true);
    expect(hits.some((hit) => hit.kind === 'article')).toBe(true);
  });

  it('筛选：短篇 / 系列 / 作者 / 角色', async () => {
    const { engine } = await buildFixture();
    expect(engine.search('魔理沙', { filter: 'short' }).every((hit) => hit.kind === 'article')).toBe(true);
    expect(engine.search('日常', { filter: 'series' }).every((hit) => hit.kind === 'series')).toBe(true);
    expect(engine.search('魔理沙', { filter: 'author' }).every((hit) => hit.kind === 'author')).toBe(true);
    expect(
      engine.search('魔理沙', { filter: 'tag-character' }).every((hit) => hit.kind === 'tag'),
    ).toBe(true);
  });

  it('空查询不崩、无结果', async () => {
    const { engine } = await buildFixture();
    expect(engine.search('')).toEqual([]);
    expect(engine.search('   ')).toEqual([]);
  });

  it('正则元字符与超长查询不崩', async () => {
    const { engine } = await buildFixture();
    expect(() => engine.search('.*+?[]()')).not.toThrow();
    expect(() => engine.search('魔'.repeat(10_000))).not.toThrow();
  });

  it('删除后不再命中', async () => {
    const { engine } = await buildFixture();
    expect(engine.search('魔法使').length).toBeGreaterThan(0);
    engine.dispose();
    expect(engine.search('魔法使')).toEqual([]);
  });
});

describe('createSearchEngine', () => {
  it('手动添加的文档可检索，并按权重排序', () => {
    const engine = createSearchEngine();
    engine.add([
      {
        rid: 'a:1',
        kind: 'article',
        id: '1',
        updatedAt: '2026-01-01T00:00:00.000Z',
        virtual: [],
        tagNames: [],
        tokens: { title: tokenizeZh('魔理沙'), body: tokenizeZh('无关内容') },
      },
      {
        rid: 'a:2',
        kind: 'article',
        id: '2',
        updatedAt: '2025-01-01T00:00:00.000Z',
        virtual: [],
        tagNames: [],
        tokens: { title: tokenizeZh('别的标题'), body: tokenizeZh('魔理沙 出现一次') },
      },
    ]);
    const hits = engine.search('魔理沙');
    expect(hits.map((hit) => hit.id)).toEqual(['1', '2']);
    expect(hits[0]?.matchedFields).toContain('title');
  });
});

describe('buildSnippets', () => {
  it('把命中词标成 highlighted，并合并邻近窗口', () => {
    const source = `${'前'.repeat(10)}魔理沙在红魔馆喝茶${'后'.repeat(60)}`;
    const snippets = buildSnippets(source, ['魔理沙', '红魔馆']);
    expect(snippets.length).toBe(1);
    const parts = snippets[0] ?? [];
    expect(parts.filter((part) => part.highlighted).map((part) => part.text)).toEqual([
      '魔理沙',
      '红魔馆',
    ]);
    expect(flattenSnippet(parts)).toContain('魔理沙在红魔馆喝茶');
  });

  it('没有命中时返回空数组', () => {
    expect(buildSnippets('普通内容', ['不存在'])).toEqual([]);
  });
});

describe('search service（导入后的真实数据流）', () => {
  it('建索引后可检索、可筛选、可命中 #已完结', async () => {
    const platform = createMemoryPlatform();
    const io = ioFor(platform);

    // 1) 在内存盘上造一个合法的包目录，再把正文写进 markdown
    const raw = makeDatabase();
    const { db, markdown } = normalizeDatabase(raw);
    for (const article of db.articles) {
      markdown.set(article.id, `# ${article.title}\n\n魔理沙在红魔馆读魔导书。\n`);
    }
    const seed = platform.paths.join(platform.paths.dataDir, 'seed');
    await writeDatabaseDir(io, seed, serializeDatabase(db, markdown));
    // 图片字节不属于文本序列化的一部分，这里补一个合法的 PNG 头
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (const image of db.images) {
      const imagePath = platform.paths.join(seed, image.file);
      await platform.fs.mkdir(platform.paths.dirname(imagePath));
      await platform.fs.writeBytes(imagePath, png);
    }

    // 2) 压成 .tpr，走正式导入流程（校验 + 落 workspace）
    const zipPath = platform.paths.join(platform.paths.dataDir, 'seed.tpr');
    await platform.zip.createFromDir(seed, zipPath, { order: ['manifest.json'] });
    const services = createServices(platform);
    const outcome = await services.library.importBytes(await platform.fs.readBytes(zipPath));
    expect(outcome.report.ok).toBe(true);

    // 3) 服务建索引并搜索
    const all = await services.search.search('魔理沙');
    expect(all.total).toBeGreaterThan(0);
    expect(all.indexSize).toBeGreaterThan(0);
    expect(all.items.some((item) => item.kind === 'article')).toBe(true);

    const shortOnly = await services.search.search('魔理沙', { filter: 'short' });
    expect(shortOnly.items.every((item) => item.kind === 'article')).toBe(true);
    expect(shortOnly.items.some((item) => item.badges.includes('短篇文'))).toBe(true);

    const completed = await services.search.search('#已完结');
    expect(completed.items.some((item) => item.kind === 'series')).toBe(true);

    // 结果里的片段来自正文，且标出了命中词
    const withSnippet = all.items.find((item) => item.snippets.length > 0);
    expect(withSnippet).toBeDefined();
    const text = flattenSnippet(withSnippet?.snippets[0] ?? []);
    expect(text).toContain('魔理沙');
  });
});
