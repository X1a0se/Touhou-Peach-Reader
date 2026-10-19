import { VIRTUAL_TAG_LABELS } from '@tpr/core';
import { normalizeName, type Tag } from '@tpr/schema';

/**
 * 搜索框 `#` 标签联想（Goal 16）。
 *
 * 纯函数：给查询串 + 光标位置 + 当前库的标签，算出「正在输入的 #片段」与候选。
 * 不依赖 DOM，便于单测；UI 只负责渲染与键盘。
 */

export interface TagSuggestion {
  /** 展示的标签名（不含 #） */
  name: string;
  /** 右侧提示：虚拟标签说明 / 标签类别 */
  hint: string;
  category: 'virtual' | Tag['category'];
}

export interface SuggestionState {
  /** 光标所在 `#` 的位置（query 下标） */
  start: number;
  /** `#` 之后已输入的文字 */
  fragment: string;
  items: TagSuggestion[];
}

const MAX_CANDIDATES = 8;

const CATEGORY_HINT: Record<Tag['category'], string> = {
  character: '角色',
  plot: '情节',
  series: '系列',
  general: '主题',
};

/** 从按了 # 的那段文本里取片段；不在 # 语境里返回 null */
export function tagFragmentAt(query: string, caret: number): { start: number; fragment: string } | null {
  const upto = query.slice(0, Math.max(0, Math.min(caret, query.length)));
  const match = /(?:^|\s)#([^\s#"]*)$/u.exec(upto);
  if (!match) return null;
  return { start: upto.lastIndexOf('#'), fragment: match[1] ?? '' };
}

export function computeTagSuggestions(
  query: string,
  caret: number,
  tags: readonly Tag[],
  limit = MAX_CANDIDATES,
): SuggestionState | null {
  const at = tagFragmentAt(query, caret);
  if (!at) return null;

  const fragment = normalizeName(at.fragment);
  const items: TagSuggestion[] = [];

  for (const virtual of VIRTUAL_TAG_LABELS) {
    if (fragment && !normalizeName(virtual.name).includes(fragment)) continue;
    items.push({ name: virtual.name, hint: virtual.description, category: 'virtual' });
  }

  const matched = tags
    .filter((tag) => {
      if (!fragment) return true;
      if (normalizeName(tag.name).includes(fragment)) return true;
      return (tag.aliases ?? []).some((alias) => normalizeName(alias).includes(fragment));
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'));

  for (const tag of matched) {
    items.push({ name: tag.name, hint: CATEGORY_HINT[tag.category] ?? '标签', category: tag.category });
  }

  const unique: TagSuggestion[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = normalizeName(item.name);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length >= limit) break;
  }

  return unique.length > 0 ? { start: at.start, fragment: at.fragment, items: unique } : null;
}

/** 把选中的标签替换进查询串；返回新串与光标位置（# 之后） */
export function applyTagSuggestion(
  query: string,
  caret: number,
  suggestion: SuggestionState,
  name: string,
): { query: string; caret: number } {
  const end = Math.max(caret, suggestion.start + 1 + suggestion.fragment.length);
  const next = `${query.slice(0, suggestion.start + 1)}${name} ${query.slice(end)}`;
  return { query: next, caret: suggestion.start + 1 + name.length + 1 };
}
