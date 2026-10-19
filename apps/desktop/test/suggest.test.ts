import type { Tag } from '@tpr/schema';
import { describe, expect, it } from 'vitest';
import { applyTagSuggestion, computeTagSuggestions, tagFragmentAt } from '../src/search/suggest.js';

const tags: Tag[] = [
  { id: 't_000000000001', category: 'character', name: '博丽灵梦', aliases: ['Reimu'] },
  { id: 't_000000000002', category: 'plot', name: '日常' },
  { id: 't_000000000003', category: 'series', name: '红魔乡' },
];

describe('search/suggest: # 标签联想纯函数', () => {
  it('suggest-fragment: 只在 # 语境里返回片段', () => {
    expect(tagFragmentAt('博丽', 2)).toBeNull();
    expect(tagFragmentAt('博丽 #灵', 5)).toEqual({ start: 3, fragment: '灵' });
    expect(tagFragmentAt('#', 1)).toEqual({ start: 0, fragment: '' });
    // 空格之后的 # 才算
    expect(tagFragmentAt('abc#x', 5)).toBeNull();
  });

  it('suggest-empty-fragment: 刚打 # 时给出虚拟标签 + 全部标签', () => {
    const state = computeTagSuggestions('#', 1, tags);
    expect(state).not.toBeNull();
    expect(state?.items.some((item) => item.category === 'virtual')).toBe(true);
    expect(state?.items.map((item) => item.name)).toEqual(
      expect.arrayContaining(['已完结', '连载中', '短篇文', '系列文', '博丽灵梦', '日常', '红魔乡']),
    );
  });

  it('suggest-filter: 按标签名与别名过滤（大小写无关）', () => {
    expect(computeTagSuggestions('#re', 3, tags)?.items.map((item) => item.name)).toContain('博丽灵梦');
    expect(computeTagSuggestions('#灵', 2, tags)?.items.map((item) => item.name)).toEqual(['博丽灵梦']);
    expect(computeTagSuggestions('#红', 2, tags)?.items.map((item) => item.name)).toEqual(['红魔乡']);
  });

  it('suggest-virtual: 输入「完结」只命中虚拟标签', () => {
    const items = computeTagSuggestions('#完结', 3, tags)?.items ?? [];
    expect(items.map((item) => item.name)).toContain('已完结');
    expect(items.every((item) => item.category !== 'character')).toBe(true);
  });

  it('suggest-limit: 最多 8 条', () => {
    const many: Tag[] = Array.from({ length: 20 }, (_, index) => ({
      id: `t_${String(index).padStart(12, '0')}`,
      category: 'general' as const,
      name: `标签${index}`,
    }));
    const state = computeTagSuggestions('#', 1, many);
    expect(state?.items.length).toBeLessThanOrEqual(8);
  });

  it('suggest-apply: 选中后替换 # 片段并把光标放到名字之后', () => {
    const state = computeTagSuggestions('博丽 #灵', 5, tags);
    expect(state).not.toBeNull();
    if (!state) return;
    const applied = applyTagSuggestion('博丽 #灵', 5, state, '博丽灵梦');
    expect(applied.query).toBe('博丽 #博丽灵梦 ');
    expect(applied.caret).toBe(9);
    expect(applied.query.slice(0, applied.caret - 1)).toBe('博丽 #博丽灵梦');
  });

  it('suggest-apply-mid: 光标在词中时替换到词尾', () => {
    const state = computeTagSuggestions('#灵 追加', 2, tags);
    if (!state) throw new Error('应当有候选');
    // caret=2 位于「灵」之后，片段从 index 1 开始，长度为 1
    const applied = applyTagSuggestion('#灵 追加', 2, state, '博丽灵梦');
    expect(applied.query).toBe('#博丽灵梦  追加');
  });

  it('suggest-none: 没有匹配标签时返回 null', () => {
    expect(computeTagSuggestions('#zzz', 4, tags)).toBeNull();
  });
});
