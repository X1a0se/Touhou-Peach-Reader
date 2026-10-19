/**
 * 中文分词（design §11.2）。
 *
 * FlexSearch 默认按空白切词，中文整句会变成一个 token。这里先用自己的分词器把文本
 * 规整成"空格分隔的检索词串"，索引与查询走同一个函数，保证 token 对齐。
 *
 * 注意：`Intl.Segmenter` 会把「雾雨魔理沙」切成「雾/雨/魔/理沙」，不能只依赖它。
 * 所以 CJK 连续串自己按"整串 + 全部二元组"处理，拉丁串才交给 Segmenter 切词。
 */

const CJK_RUN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]+/gu;
const SEPARATOR = /[\s\u3000，。！？、；：""''（）《》【】〈〉…—·!?.,;:()[\]{}"'`|/\\]+/u;

export function isCjk(text: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/u.test(text);
}

function segmentWords(text: string): string[] {
  if (!text) return [];
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter('zh-Hans', { granularity: 'word' });
    const out: string[] = [];
    for (const { segment, isWordLike } of segmenter.segment(text)) {
      if (isWordLike) out.push(segment.trim());
    }
    return out.filter(Boolean);
  }
  return text.split(SEPARATOR).filter(Boolean);
}

/** 把文本切成「CJK 连续串」与「非 CJK 片段」 */
function splitRuns(text: string): Array<{ cjk: boolean; value: string }> {
  const runs: Array<{ cjk: boolean; value: string }> = [];
  let cursor = 0;
  for (const match of text.matchAll(CJK_RUN)) {
    const at = match.index ?? 0;
    if (at > cursor) runs.push({ cjk: false, value: text.slice(cursor, at) });
    runs.push({ cjk: true, value: match[0] });
    cursor = at + match[0].length;
  }
  if (cursor < text.length) runs.push({ cjk: false, value: text.slice(cursor) });
  return runs;
}

/**
 * 中文：整串 + 全部二元组（未登录词也能命中）；拉丁/数字：整词。
 * 结果去重、保序。
 */
export function tokenizeZh(input: string): string[] {
  const text = input.normalize('NFKC').toLowerCase();
  if (!text.trim()) return [];

  const out: string[] = [];
  for (const run of splitRuns(text)) {
    if (run.cjk) {
      out.push(run.value);
      for (let i = 0; i + 1 < run.value.length; i++) out.push(run.value.slice(i, i + 2));
    } else {
      for (const word of segmentWords(run.value)) out.push(word);
    }
  }
  return dedupe(out);
}

export function toIndexText(input: string): string {
  return tokenizeZh(input).join(' ');
}

/** 只保留长度 2 的 CJK 二元组（第二段放宽召回用） */
export function bigramsOnly(tokens: readonly string[]): string[] {
  return tokens.filter((token) => token.length === 2 && isCjk(token));
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
