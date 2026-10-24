import { normalizeTagName } from '@tpr/core';
import type { Tag, TagCategory } from '@tpr/schema';

/** 标签筛选列表的分类顺序与中文名（design §11.7） */
export const TAG_CATEGORY_ORDER: readonly TagCategory[] = [
  'character',
  'plot',
  'series',
  'general',
];

export const TAG_CATEGORY_LABEL: Record<TagCategory, string> = {
  character: '角色',
  plot: '情节',
  series: '系列',
  general: '主题',
};

export const TAG_FILTER_LIMIT = 40;

/** 选中标签按 normalizeTagName 归一化、去重、去空，保持首次出现的顺序。 */
export function normalizeSelectedTags(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const name = normalizeTagName(value);
    if (name === '' || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** 点选/取消一个标签；已选中（按归一化名比较）则移除。 */
export function toggleSelectedTag(values: readonly string[], name: string): string[] {
  const target = normalizeTagName(name);
  if (target === '') return [...values];
  return values.some((value) => normalizeTagName(value) === target)
    ? values.filter((value) => normalizeTagName(value) !== target)
    : [...values, target];
}

export interface TagFilterResult {
  items: Tag[];
  total: number;
}

/**
 * 标签筛选器的可见列表：匹配名称、别名和分类名；按角色→情节→系列→主题、再按名称排序。
 * 最多返回 limit 条，total 仍是完整匹配数，供界面提示“还有多少”。
 */
export function filterSearchTags(
  tags: readonly Tag[],
  query: string,
  limit = TAG_FILTER_LIMIT,
): TagFilterResult {
  const needle = normalizeTagName(query);
  const matched = tags.filter((tag) => {
    if (needle === '') return true;
    const haystack = normalizeTagName(
      [tag.name, ...(tag.aliases ?? []), TAG_CATEGORY_LABEL[tag.category]].join(' '),
    );
    return haystack.includes(needle);
  });
  matched.sort((a, b) => {
    const byCategory =
      TAG_CATEGORY_ORDER.indexOf(a.category) - TAG_CATEGORY_ORDER.indexOf(b.category);
    return byCategory !== 0 ? byCategory : a.name.localeCompare(b.name, 'zh-Hans-CN');
  });
  return { items: matched.slice(0, limit), total: matched.length };
}

/** 选中标签的展示名：优先用库里标签的原始大小写/写法，找不到时退回归一化名。 */
export function tagDisplayName(name: string, tags: readonly Tag[]): string {
  const target = normalizeTagName(name);
  return tags.find((tag) => normalizeTagName(tag.name) === target)?.name ?? name;
}
