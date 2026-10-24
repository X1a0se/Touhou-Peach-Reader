import { describe, expect, it } from 'vitest';
import { groupSearchItems } from '../src/search/group.js';
import type { SearchItem } from '../src/search/service.js';

function article(id: string, seriesId: string, index: number, total = 2): SearchItem {
  return {
    kind: 'article',
    id,
    title: `第${index}篇`,
    subtitle: '',
    updatedAt: '2026-01-01T00:00:00.000Z',
    score: 10 - index,
    matchedFields: ['title'],
    badges: ['系列文'],
    snippets: [],
    series: {
      id: seriesId,
      title: '测试系列',
      status: 'ongoing',
      index,
      total,
    },
  };
}

function short(id: string): SearchItem {
  return {
    kind: 'article',
    id,
    title: '独立短篇',
    subtitle: '',
    updatedAt: '2026-01-01T00:00:00.000Z',
    score: 5,
    matchedFields: ['title'],
    badges: ['短篇文'],
    snippets: [],
  };
}

function seriesEntity(id: string): SearchItem {
  return {
    kind: 'series',
    id,
    title: '测试系列',
    subtitle: '系列简介',
    updatedAt: '2026-01-01T00:00:00.000Z',
    score: 8,
    matchedFields: ['title'],
    badges: ['连载中'],
    snippets: [],
  };
}

describe('groupSearchItems（Goal 25）', () => {
  it('同一系列命中 >=2 篇时在最高名次处成组，并保持原排名顺序', () => {
    const a1 = article('a1', 's1', 1);
    const a2 = article('a2', 's1', 2);
    const entity = seriesEntity('s1');
    const other = short('b1');
    const rows = groupSearchItems([a1, other, entity, a2]);
    expect(rows.map((row) => row.kind)).toEqual(['group', 'item']);
    const group = rows[0];
    if (group?.kind !== 'group') throw new Error('expected group');
    expect(group.series.id).toBe('s1');
    expect(group.items.map((item) => item.id)).toEqual(['a1', 'a2']);
    expect(group.seriesItem?.id).toBe('s1');
    expect(rows[1]).toEqual({ kind: 'item', item: other });
  });

  it('系列实体排在最前时由实体位置成组，不重复占行', () => {
    const entity = seriesEntity('s1');
    const rows = groupSearchItems([entity, article('a1', 's1', 1), article('a2', 's1', 2)]);
    expect(rows).toHaveLength(1);
    const group = rows[0];
    if (group?.kind !== 'group') throw new Error('expected group');
    expect(group.seriesItem).toBe(entity);
    expect(group.items.map((item) => item.id)).toEqual(['a1', 'a2']);
  });

  it('只有一篇命中时不成组，系列实体也保持独立', () => {
    const a1 = article('a1', 's1', 1);
    const entity = seriesEntity('s1');
    const rows = groupSearchItems([a1, entity]);
    expect(rows).toEqual([
      { kind: 'item', item: a1 },
      { kind: 'item', item: entity },
    ]);
  });

  it('不同系列各自成组，互不合并', () => {
    const rows = groupSearchItems([
      article('a1', 's1', 1),
      article('b1', 's2', 1),
      article('a2', 's1', 2),
      article('b2', 's2', 2),
    ]);
    expect(rows.map((row) => (row.kind === 'group' ? row.series.id : row.kind))).toEqual([
      's1',
      's2',
    ]);
  });

  it('没有系列信息的文章保持原样', () => {
    const items = [short('b1'), short('b2')];
    expect(groupSearchItems(items)).toEqual(items.map((item) => ({ kind: 'item', item })));
  });
});
