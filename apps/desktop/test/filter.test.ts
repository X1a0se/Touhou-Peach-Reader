import { describe, expect, it } from 'vitest';
import { createQueryMatcher, filterByQuery, joinSearchParts, matchesQuery } from '../src/editor/filter.js';

describe('editor filter helpers', () => {
  it('joins only non-empty parts', () => {
    expect(joinSearchParts(['a', '', undefined, null, 'b'])).toBe('a b');
  });

  it('matches all tokens after normalization', () => {
    expect(matchesQuery('ＡＢＣ　Project', 'abc')).toBe(true);
    expect(matchesQuery('ＡＢＣ　Project', 'abc project')).toBe(true);
    expect(matchesQuery('ＡＢＣ　Project', 'abc 缺失')).toBe(false);
  });

  it('empty query matches everything', () => {
    const match = createQueryMatcher('   ');
    expect(match('anything')).toBe(true);
    expect(filterByQuery([1, 2, 3], '', String)).toEqual([1, 2, 3]);
  });

  it('filters by haystack', () => {
    const items = [
      { id: 'a', name: '灵梦' },
      { id: 'b', name: '魔理沙' },
    ];
    expect(filterByQuery(items, '魔理', (item) => item.name).map((item) => item.id)).toEqual(['b']);
  });
});
