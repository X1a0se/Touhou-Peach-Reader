import { makeArticle, makeDatabase, makeSeries, makeTag } from '@tpr/schema/testing';
import { describe, expect, it } from 'vitest';
import { mergeDuplicateTags } from '../src/db/tag-merge.js';

describe('mergeDuplicateTags', () => {
  it('合并同类别、归一化同名的标签，并入别名并改写引用', () => {
    const a = makeTag({ id: 't_000000000001', category: 'plot', name: 'R18', aliases: ['18+'] });
    const b = makeTag({ id: 't_000000000002', category: 'plot', name: 'ｒ１８', aliases: ['成人', '18+'] });
    const character = makeTag({ id: 't_000000000003', category: 'character', name: 'R18' });
    const normal = makeTag({ id: 't_000000000004', category: 'general', name: '日常' });
    const article = makeArticle({
      id: 'a_0000000000000001',
      plotTagIds: [a.id, b.id, character.id, normal.id],
      characterTagIds: [character.id],
    });
    const series = makeSeries({ id: 's_0000000000000001', plotTagIds: [b.id, a.id] });
    const db = makeDatabase(
      { tags: [a, b, character, normal], articles: [article], series: [series] },
      { withFiles: false },
    );
    const before = JSON.stringify(db);

    const result = mergeDuplicateTags(db);

    expect(result.groups).toEqual([
      { name: 'R18', category: 'plot', targetId: a.id, removedIds: [b.id] },
    ]);
    expect(result.db.tags.map((tag) => tag.id)).toEqual([a.id, character.id, normal.id]);
    const merged = result.db.tags.find((tag) => tag.id === a.id);
    expect(merged?.aliases).toEqual(['18+', '成人']);
    expect(result.db.articles[0]?.plotTagIds).toEqual([a.id, character.id, normal.id]);
    expect(result.db.articles[0]?.characterTagIds).toEqual([character.id]);
    expect(result.db.series[0]?.plotTagIds).toEqual([a.id]);
    // 不原地修改
    expect(JSON.stringify(db)).toBe(before);
  });

  it('跨类别同名不合并', () => {
    const plot = makeTag({ id: 't_000000000011', category: 'plot', name: 'R18' });
    const general = makeTag({ id: 't_000000000012', category: 'general', name: 'R18' });
    const db = makeDatabase({ tags: [plot, general] }, { withFiles: false });
    const result = mergeDuplicateTags(db);
    expect(result.groups).toEqual([]);
    expect(result.db.tags).toHaveLength(2);
  });

  it('同 id 重复条目去重，不产生多余引用改写', () => {
    const tag = makeTag({ id: 't_000000000021', category: 'plot', name: 'R18' });
    const article = makeArticle({ id: 'a_0000000000000002', plotTagIds: [tag.id] });
    const db = makeDatabase({ tags: [tag, { ...tag }], articles: [article] }, { withFiles: false });
    const result = mergeDuplicateTags(db);
    expect(result.groups).toEqual([]);
    expect(result.db.tags).toHaveLength(1);
    expect(result.db.articles[0]?.plotTagIds).toEqual([tag.id]);
  });

  it('无重复时返回等价数据', () => {
    const db = makeDatabase({}, { withFiles: false });
    const result = mergeDuplicateTags(db);
    expect(result.groups).toEqual([]);
    expect(result.db.tags).toEqual(db.tags);
  });
});
