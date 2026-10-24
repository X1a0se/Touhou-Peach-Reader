import { makeTag } from '@tpr/schema/testing';
import { describe, expect, it } from 'vitest';
import {
  filterSearchTags,
  normalizeSelectedTags,
  TAG_CATEGORY_LABEL,
  tagDisplayName,
  toggleSelectedTag,
} from '../src/search/tags.js';

describe('搜索多标签辅助函数（Goal 25）', () => {
  it('归一化、去空并去重，保留首次出现顺序', () => {
    expect(normalizeSelectedTags([' 红魔馆 ', '红魔馆', 'REIMU', '  ', 'reimu'])).toEqual([
      '红魔馆',
      'reimu',
    ]);
    expect(normalizeSelectedTags([])).toEqual([]);
  });

  it('点选新增归一化标签，再次点选可移除（大小写不敏感）', () => {
    const once = toggleSelectedTag([], ' 博丽灵梦 ');
    expect(once).toEqual(['博丽灵梦']);
    expect(toggleSelectedTag(once, '博丽灵梦')).toEqual([]);
    const mixed = toggleSelectedTag(['Reimu'], 'reimu');
    expect(mixed).toEqual([]);
    expect(toggleSelectedTag(['红魔馆'], '')).toEqual(['红魔馆']);
  });

  it('按名称、别名和分类名匹配标签', () => {
    const tags = [
      makeTag({ category: 'character', name: '雾雨魔理沙', aliases: ['魔理沙', 'Marisa'] }),
      makeTag({ category: 'plot', name: '红魔馆' }),
      makeTag({ category: 'general', name: '日常' }),
    ];

    expect(filterSearchTags(tags, 'marisa').items.map((tag) => tag.name)).toEqual(['雾雨魔理沙']);
    expect(filterSearchTags(tags, '情节').items.map((tag) => tag.name)).toEqual(['红魔馆']);
    expect(filterSearchTags(tags, '魔理沙').items.map((tag) => tag.name)).toEqual(['雾雨魔理沙']);
    expect(filterSearchTags(tags, '').total).toBe(3);
  });

  it('按角色→情节→系列→主题排序，同分类按名称稳定排序', () => {
    const tags = [
      makeTag({ category: 'general', name: 'B' }),
      makeTag({ category: 'plot', name: 'B' }),
      makeTag({ category: 'character', name: 'B' }),
      makeTag({ category: 'character', name: 'A' }),
      makeTag({ category: 'series', name: 'B' }),
    ];

    expect(filterSearchTags(tags, '').items.map((tag) => `${tag.category}:${tag.name}`)).toEqual([
      'character:A',
      'character:B',
      'plot:B',
      'series:B',
      'general:B',
    ]);
    expect(TAG_CATEGORY_LABEL.plot).toBe('情节');
  });

  it('限制返回数量但保留完整匹配数，供界面提示', () => {
    const tags = Array.from({ length: 5 }, (_, index) =>
      makeTag({ category: 'general', name: `标签${index}` }),
    );
    const result = filterSearchTags(tags, '', 2);
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(5);
  });

  it('展示名优先使用库里的原始写法，找不到时退回归一化名', () => {
    const tags = [makeTag({ category: 'character', name: 'Reimu' })];
    expect(tagDisplayName('reimu', tags)).toBe('Reimu');
    expect(tagDisplayName('未知标签', tags)).toBe('未知标签');
  });
});
