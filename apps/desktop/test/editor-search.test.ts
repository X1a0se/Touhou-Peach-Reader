import { type DBSnapshot, toSnapshot } from '@tpr/core';
import type { ArticleFile, Author, ImageAsset, RawDatabase, Series, Tag } from '@tpr/schema';
import { emptyRawDatabase } from '@tpr/schema';
import {
  FIXED_TIME,
  makeArticle,
  makeAuthor,
  makeCredits,
  makeImage,
  makeSeries,
  makeTag,
} from '@tpr/schema/testing';
import { describe, expect, it } from 'vitest';
import {
  type EditorKind,
  type EditorSearchResult,
  searchEditor,
  tokenizeQuery,
} from '../src/editor/search.js';

interface Fixture {
  snapshot: DBSnapshot;
  reimu: Author;
  marisa: Author;
  reimuTag: Tag;
  dailyTag: Tag;
  spring: ArticleFile;
  seriesEntry: ArticleFile;
  series: Series;
  cover: ImageAsset;
  illustration: ImageAsset;
}

/** 一个覆盖七类实体的小库；正文里埋了只应出现在磁盘上的词。 */
function createFixture(): Fixture {
  const reimu = makeAuthor({ canonicalName: '博丽灵梦', aliases: ['Reimu', '灵梦'] });
  const marisa = makeAuthor({ canonicalName: '雾雨魔理沙', aliases: ['Marisa'] });
  const reimuTag = makeTag({ category: 'character', name: '博丽灵梦', aliases: ['灵梦'] });
  const dailyTag = makeTag({ category: 'plot', name: '日常' });
  const cover = makeImage({ kind: 'cover', caption: '封面：灵梦' });
  const illustration = makeImage({ kind: 'illustration' });

  const series = makeSeries({ title: '红魔乡', summary: '魔理沙的故事', status: 'completed' });
  const seriesEntry = makeArticle({
    type: 'series-entry',
    seriesId: series.id,
    title: '红魔乡前篇',
    summary: '红雾异变的第一篇。',
    content: { file: 'articles/entry.md' },
    authorIds: [marisa.id],
  });
  series.articleIds = [seriesEntry.id];

  const spring = makeArticle({
    title: '春雪异变',
    summary: '灵梦在冬天遇到异变。',
    content: '白玉楼上的正文，不该被搜索命中。',
    authorIds: [reimu.id],
    characterTagIds: [reimuTag.id],
    plotTagIds: [dailyTag.id],
  });
  const plain = makeArticle({
    title: '无关短篇',
    summary: '没有任何关键词。',
    content: '正文。',
  });

  const raw: RawDatabase = {
    manifest: {
      schemaVersion: 1,
      databaseId: 'db_goal21_search',
      name: '搜索测试库',
      version: '1.0.0',
      updatedAt: FIXED_TIME,
      counts: {},
    },
    authors: [reimu, marisa],
    tags: [reimuTag, dailyTag],
    images: [cover, illustration],
    articles: [spring, seriesEntry, plain],
    series: [series],
    featured: [
      {
        targetType: 'article',
        targetId: spring.id,
        recommendations: [{ author: '阿求', text: '节奏很好。' }],
      },
      { targetType: 'series', targetId: series.id, recommendations: [{ text: '分镜出色。' }] },
    ],
    credits: [
      { name: 'ZUN', role: '原作', note: '东方 Project 原作者' },
      makeCredits({ name: '译者小明', role: '翻译', note: '中文润色' }),
    ],
  };

  return {
    snapshot: toSnapshot(raw),
    reimu,
    marisa,
    reimuTag,
    dailyTag,
    spring,
    seriesEntry,
    series,
    cover,
    illustration,
  };
}

const fx = createFixture();

function search(rawQuery: string, limitPerKind?: number): EditorSearchResult {
  const result = searchEditor(fx.snapshot, rawQuery, limitPerKind);
  if (!result) throw new Error(`查询「${rawQuery}」应当返回结果`);
  return result;
}

function hitsOf(result: EditorSearchResult, kind: EditorKind): EditorSearchResult['hits'] {
  return result.hits.filter((hit) => hit.kind === kind);
}

describe('editor/search: 编辑器全实体搜索', () => {
  it('search-articles-title: 标题子串命中并给出短篇说明', () => {
    const result = search('春雪');
    expect(result.totals.articles).toBe(1);
    expect(hitsOf(result, 'articles')).toEqual([
      { kind: 'articles', id: fx.spring.id, label: '春雪异变', detail: '短篇' },
    ]);
    expect(result.ids.articles.has(fx.spring.id)).toBe(true);
    expect(result.ids.articles.has(fx.seriesEntry.id)).toBe(false);
  });

  it('search-articles-series-position: 系列条目给出「系列 + 第 N 篇」', () => {
    const result = search('红魔乡');
    expect(hitsOf(result, 'articles')).toEqual([
      {
        kind: 'articles',
        id: fx.seriesEntry.id,
        label: '红魔乡前篇',
        detail: '系列《红魔乡》第 1 篇',
      },
    ]);
    expect(hitsOf(result, 'series')).toEqual([
      { kind: 'series', id: fx.series.id, label: '红魔乡', detail: '1 篇' },
    ]);
  });

  it('search-body-not-indexed: 正文不参与搜索', () => {
    const result = search('白玉楼');
    expect(result.hits).toEqual([]);
    expect(Object.values(result.totals).every((count) => count === 0)).toBe(true);
    expect(Object.values(result.ids).every((set) => set.size === 0)).toBe(true);
  });

  it('search-author-alias: 作者别名命中且大小写无关', () => {
    const result = search('MARISA');
    expect(hitsOf(result, 'authors')).toEqual([
      {
        kind: 'authors',
        id: fx.marisa.id,
        label: '雾雨魔理沙',
        detail: '别名：Marisa',
      },
    ]);
    expect(result.ids.authors.size).toBe(1);
  });

  it('search-tag-category: 标签名与类别都参与匹配', () => {
    const result = search('情节');
    expect(hitsOf(result, 'tags')).toEqual([
      { kind: 'tags', id: fx.dailyTag.id, label: '日常', detail: '情节' },
    ]);
    expect(result.ids.tags.size).toBe(1);
  });

  it('search-images: caption、id 与类型都可搜', () => {
    const byCaption = search('封面');
    expect(hitsOf(byCaption, 'images')).toEqual([
      { kind: 'images', id: fx.cover.id, label: '封面：灵梦', detail: '封面' },
    ]);

    const byId = search(fx.illustration.id);
    expect(byId.ids.images.has(fx.illustration.id)).toBe(true);
    expect(hitsOf(byId, 'images')[0]?.label).toBe(fx.illustration.id);
  });

  it('search-featured: 推荐语正文、推荐人与目标标题都能命中', () => {
    const byText = search('分镜');
    expect(hitsOf(byText, 'featured')).toEqual([
      {
        kind: 'featured',
        id: `series:${fx.series.id}`,
        label: '红魔乡',
        detail: '1 条推荐语',
      },
    ]);

    const byRecommend = search('阿求');
    expect(byRecommend.ids.featured.has(`article:${fx.spring.id}`)).toBe(true);
  });

  it('search-credits: 鸣谢按姓名、角色、备注匹配，id 用序号', () => {
    const byName = search('zun');
    expect(hitsOf(byName, 'credits')).toEqual([
      { kind: 'credits', id: 'credits:0', label: 'ZUN', detail: '原作' },
    ]);

    const byNote = search('润色');
    expect(hitsOf(byNote, 'credits').map((hit) => hit.id)).toEqual(['credits:1']);
    expect(byNote.ids.credits.size).toBe(1);
  });

  it('search-and-tokens: 多个关键词必须全部命中', () => {
    const result = search('灵梦 日常');
    expect(result.totals.articles).toBe(1);
    expect([...result.ids.articles]).toEqual([fx.spring.id]);
    expect(result.ids.tags.size).toBe(0);
    expect(result.ids.authors.size).toBe(0);
  });

  it('search-tokenize: 归一化后按空白切分并去重', () => {
    expect(tokenizeQuery(' 灵梦　灵梦 ')).toEqual(['灵梦']);
    expect(tokenizeQuery('Ｒｅｉｍｕ  Reimu')).toEqual(['reimu']);
  });

  it('search-empty: 空与纯空白查询返回 null', () => {
    expect(searchEditor(fx.snapshot, '')).toBeNull();
    expect(searchEditor(fx.snapshot, '   ')).toBeNull();
    expect(searchEditor(fx.snapshot, '\u3000\u3000')).toBeNull();
  });

  it('search-none: 没有匹配时返回空结果而不是 null', () => {
    const result = search('不存在的关键词xyz');
    expect(result.hits).toEqual([]);
    expect(result.totals).toEqual({
      articles: 0,
      series: 0,
      authors: 0,
      tags: 0,
      images: 0,
      featured: 0,
      credits: 0,
    });
    expect(Object.values(result.ids).every((set) => set.size === 0)).toBe(true);
  });

  it('search-hits-order: 下拉按标签页顺序排列', () => {
    const result = search('魔理沙');
    expect(result.hits.map((hit) => hit.kind)).toEqual(['articles', 'series', 'authors']);
  });

  it('search-limit: hits 受 limit 限制，totals 与 ids 保留全量', () => {
    const tags = Array.from({ length: 10 }, (_, index) =>
      makeTag({ category: 'general', name: `限定标签${index}` }),
    );
    const raw = emptyRawDatabase({ name: '限定标签库' });
    const snapshot = toSnapshot({ ...raw, tags });

    const result = searchEditor(snapshot, '限定标签', 3);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(hitsOf(result, 'tags')).toHaveLength(3);
    expect(result.totals.tags).toBe(10);
    expect(result.ids.tags.size).toBe(10);
  });
});
