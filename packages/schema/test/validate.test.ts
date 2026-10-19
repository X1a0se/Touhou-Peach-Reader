import { describe, expect, it } from 'vitest';
import { makeArticle, makeDatabase, makeSeries } from '../src/testing/index.js';
import { stripVirtualTags, validateDatabase } from '../src/validate.js';

const codesOf = (issues: ReadonlyArray<{ code: string }>): string[] => issues.map((i) => i.code);

describe('validateDatabase', () => {
  it('自洽的库没有任何 error 与 warning', () => {
    const result = validateDatabase(makeDatabase());
    expect(result.errors.map((e) => e.message)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.code)).toEqual([]);
  });

  it('重复 id 是 error', () => {
    const db = makeDatabase();
    const first = db.articles[0];
    if (!first) throw new Error('fixture 缺文章');
    db.articles = [first, { ...first }];
    const result = validateDatabase(db);
    expect(result.ok).toBe(false);
    expect(codesOf(result.errors)).toContain('E_DUPLICATE_ID');
  });

  it('短篇带 seriesId 或系列文缺 seriesId 都是 error', () => {
    const series = makeSeries();
    const badShort = makeArticle({ seriesId: series.id, title: '错标短篇' });
    const badEntry = makeArticle({ type: 'series-entry', title: '漏标系列文' });
    const db = makeDatabase({ articles: [badShort, badEntry], series: [{ ...series, articleIds: [] }] });
    const result = validateDatabase(db);
    expect(codesOf(result.errors).filter((c) => c === 'E_SERIES_TYPE_MISMATCH')).toHaveLength(2);
  });

  it('系列文章列表与文章 seriesId 不一致是 error', () => {
    const db = makeDatabase();
    const series = db.series[0];
    const short = db.articles.find((a) => a.type === 'short');
    if (!series || !short) throw new Error('fixture 不完整');
    series.articleIds = [...series.articleIds, short.id];
    const result = validateDatabase(db);
    expect(codesOf(result.errors)).toContain('E_SERIES_ORDER');
  });

  it('悬空作者引用只是 warning', () => {
    const db = makeDatabase();
    const article = db.articles[0];
    if (!article) throw new Error('fixture 缺文章');
    article.authorIds = ['p_0000000000ff'];
    const result = validateDatabase(db);
    expect(result.ok).toBe(true);
    expect(codesOf(result.warnings)).toContain('W_DANGLING_AUTHOR');
  });

  it('正文文件路径不符合约定是 error', () => {
    const article = makeArticle({ content: { file: 'articles/wrong-name.md' } });
    const db = makeDatabase({ articles: [article], series: [] });
    const result = validateDatabase(db);
    expect(codesOf(result.errors)).toContain('E_INVALID_CONTENT_FILE');
  });

  it('包内缺文件时报告 E_CONTENT_MISSING / E_IMAGE_FILE_MISSING', () => {
    const db = makeDatabase();
    db.filePaths = new Set<string>();
    const result = validateDatabase(db);
    expect(codesOf(result.errors)).toContain('E_CONTENT_MISSING');
    expect(codesOf(result.errors)).toContain('E_IMAGE_FILE_MISSING');
  });

  it('counts 不符只是 warning', () => {
    const db = makeDatabase();
    db.manifest = { ...db.manifest, counts: { ...db.manifest.counts, articles: 99 } };
    const result = validateDatabase(db);
    expect(result.ok).toBe(true);
    expect(codesOf(result.warnings)).toContain('W_COUNT_MISMATCH');
  });

  it('非 http(s) 链接只是 warning', () => {
    const db = makeDatabase();
    const author = db.authors[0];
    if (!author) throw new Error('fixture 缺作者');
    author.sourceUrl = 'ftp://example.com/x';
    const result = validateDatabase(db);
    expect(result.ok).toBe(true);
    expect(codesOf(result.warnings)).toContain('W_URL_SCHEME');
  });

  it('同名的两个作者会被标记为疑似重复', () => {
    const db = makeDatabase();
    const first = db.authors[0];
    if (!first) throw new Error('fixture 缺作者');
    db.authors = [first, { ...first, id: 'p_0000000000aa' }];
    const result = validateDatabase(db);
    expect(codesOf(result.warnings)).toContain('W_DUPLICATE_NAME');
  });
});

describe('stripVirtualTags', () => {
  it('丢弃 v: 前缀的标签', () => {
    const { kept, dropped } = stripVirtualTags([
      { id: 't_000000000001', name: '角色' },
      { id: 'v:completed', name: '已完结' },
    ]);
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(1);
  });
});
