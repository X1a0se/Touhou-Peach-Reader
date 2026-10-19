import { describe, expect, it } from 'vitest';
import { getJsonSchemas } from '../src/json-schema.js';
import { normalizeName, authorIdFor, tagIdFor } from '../src/ids.js';
import { parseRawDatabase } from '../src/raw.js';
import { makeDatabase } from '../src/testing/index.js';

describe('parseRawDatabase', () => {
  it('接受自洽的库', () => {
    const db = parseRawDatabase(makeDatabase());
    expect(db.articles.length).toBe(3);
  });

  it('拒绝格式不正确的 id', () => {
    const db = makeDatabase();
    const first = db.articles[0];
    if (!first) throw new Error('测试夹具应有文章');
    db.articles[0] = { ...first, id: 'article-1' };
    expect(() => parseRawDatabase(db)).toThrowError();
  });

  it('拒绝缺失必填字段', () => {
    const db = makeDatabase();
    const broken = { ...db, manifest: { ...db.manifest, name: undefined } };
    expect(() => parseRawDatabase(broken)).toThrowError();
  });
});

describe('ids', () => {
  it('normalizeName 统一全角、大小写与空白', () => {
    expect(normalizeName('  ＫＯＩＳＨＩ　ＹＵＩ ')).toBe('koishi yui');
    expect(normalizeName('雾雨  魔理沙')).toBe('雾雨 魔理沙');
  });

  it('作者 id 是确定性的', async () => {
    const a = await authorIdFor('雾雨魔理沙');
    const b = await authorIdFor('雾雨魔理沙');
    expect(a).toBe(b);
    expect(a).toMatch(/^p_[0-9a-f]{12}$/);
  });

  it('作者改名会换 id（调用方不应重算已存在实体的 id）', async () => {
    expect(await authorIdFor('魔理沙')).not.toBe(await authorIdFor('雾雨魔理沙'));
  });

  it('标签 id 区分 category', async () => {
    expect(await tagIdFor('character', '魔理沙')).not.toBe(await tagIdFor('plot', '魔理沙'));
  });
});

describe('getJsonSchemas', () => {
  it('为每个实体导出一份 JSON Schema', () => {
    const schemas = getJsonSchemas();
    expect(Object.keys(schemas)).toEqual([
      'manifest',
      'author',
      'tag',
      'imageAsset',
      'article',
      'series',
      'featuredEntry',
      'creditsEntry',
      'database',
    ]);
    const article = schemas.article as { type?: string; properties?: Record<string, unknown> };
    expect(article.type).toBe('object');
    expect(Object.keys(article.properties ?? {})).toContain('content');
    expect(JSON.stringify(schemas)).toContain('series-entry');
  });
});
