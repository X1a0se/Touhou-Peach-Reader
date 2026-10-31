import { normalizeName } from '@tpr/schema';
import { tokenizeQuery } from './search.js';

/** 把若干可空片段拼成搜索 haystack，去掉空白片段。 */
export function joinSearchParts(parts: ReadonlyArray<string | undefined | null>): string {
  return parts.filter((part): part is string => Boolean(part?.trim())).join(' ');
}

/**
 * 生成子串匹配器：大小写、全半角、空白由 normalizeName 归一化，多个关键词全部命中。
 * 空查询返回恒真匹配器，调用方不必额外判断。
 */
export function createQueryMatcher(query: string): (haystack: string) => boolean {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return () => true;
  return (haystack) => {
    const text = normalizeName(haystack);
    return tokens.every((token) => text.includes(token));
  };
}

export function matchesQuery(haystack: string, query: string): boolean {
  return createQueryMatcher(query)(haystack);
}

/** 列表过滤；空查询返回原数组的副本，便于统一渲染。 */
export function filterByQuery<T>(
  items: readonly T[],
  query: string,
  haystackOf: (item: T) => string,
): T[] {
  const match = createQueryMatcher(query);
  return items.filter((item) => match(haystackOf(item)));
}
