/**
 * 正文词数统计。
 *
 * 规则：
 * - 只统计正文文本；插图（Markdown 图片、HTML img）、HTML 标签、链接 URL、裸 URL
 *   和 HTML 实体不产生词数。
 * - 中日韩文字（汉字、假名、谚文）逐字计数；其他语言的字母/数字连续串按 1 个词计数。
 * - 代码围栏本身不计数，但代码内容照常统计（代码也是正文的一部分）。
 */
const CJK_RANGES = '\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\u3040-\\u30FF\\uAC00-\\uD7AF';
const WORD_CHAR = `(?![${CJK_RANGES}])[\\p{L}\\p{N}]`;
const TOKEN = new RegExp(`[${CJK_RANGES}]|(?:${WORD_CHAR})+(?:['’](?:${WORD_CHAR})+)*`, 'gu');

/** 去掉 Markdown/HTML 中不进入字数统计的标记与 URL，保留可读文本。 */
export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^[ \t]*(?:```|~~~).*$/gm, '')
    .replace(/!\[[^\]]*\]\((?:[^()]|\([^)]*\))*\)/g, ' ')
    .replace(/<img\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/^[ \t]{0,3}\[[^\]]+\]:\s*\S+.*$/gm, '')
    .replace(/\[\^[^\]]+\]/g, ' ')
    .replace(/^[ \t]*>+[ \t]?/gm, '')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/gm, '')
    .replace(/^[ \t]*(?:\*[ \t]*){3,}$/gm, ' ')
    .replace(/^[ \t]*(?:-[ \t]*){3,}$/gm, ' ')
    .replace(/^[ \t]*(?:_[ \t]*){3,}$/gm, ' ')
    .replace(/\\([\\`*{}\[\]()#+\-.!_>])/g, '$1')
    .replace(/[`*_~]+/g, ' ')
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>()\u3000-\u303F\uFF00-\uFFEF]+/gi, ' ')
    .replace(/&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);/gi, ' ');
}

/** 统计一段 Markdown 正文的词数；空串/纯标记返回 0。 */
export function countWords(markdown: string): number {
  if (!markdown) return 0;
  const text = stripMarkdown(markdown);
  let count = 0;
  for (const match of text.matchAll(TOKEN)) {
    // CJK 字符单独成 match，其他字母数字串整体成 match；两种都计 1。
    if (match[0]) count += 1;
  }
  return count;
}

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

/** 字数展示：1234 → "1,234"。 */
export function formatWordCount(count: number): string {
  return NUMBER_FORMAT.format(count);
}
