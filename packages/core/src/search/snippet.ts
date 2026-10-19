/**
 * 自建高亮片段（design §11.6）。
 *
 * 不用正则（term 里可能有 `.*+?`），全部用 `indexOf` 找位置；
 * 在 NFKC 归一化串上定位，再用原串切片，保证展示原样。
 */

export interface SnippetPart {
  text: string;
  highlighted: boolean;
}

export interface SnippetOptions {
  /** 命中位置两侧的字符半径，默认 40 */
  radius?: number;
  /** 最多返回几段，默认 2 */
  max?: number;
  /** 两段间隔小于该值就合并，默认 8 */
  mergeGap?: number;
  /** 单个 term 最多取几处，默认 5 */
  maxPerTerm?: number;
}

interface Range {
  start: number;
  end: number;
}

function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

function collectRanges(source: string, terms: readonly string[], opts: Required<SnippetOptions>): Range[] {
  const normalized = normalize(source);
  const ranges: Range[] = [];

  for (const term of terms) {
    const needle = normalize(term).trim();
    if (needle.length < 1) continue;

    let from = 0;
    let taken = 0;
    while (taken < opts.maxPerTerm) {
      const at = normalized.indexOf(needle, from);
      if (at === -1) break;
      ranges.push({ start: at, end: Math.min(normalized.length, at + needle.length) });
      from = at + needle.length;
      taken += 1;
    }
  }

  return ranges.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function buildSnippets(
  source: string,
  terms: readonly string[],
  options: SnippetOptions = {},
): SnippetPart[][] {
  if (!source) return [];

  const opts: Required<SnippetOptions> = {
    radius: options.radius ?? 40,
    max: options.max ?? 2,
    mergeGap: options.mergeGap ?? 8,
    maxPerTerm: options.maxPerTerm ?? 5,
  };

  const ranges = collectRanges(source, terms, opts);
  if (ranges.length === 0) return [];

  // 扩成窗口并按重叠/近邻合并
  const windows: Range[] = [];
  for (const range of ranges) {
    const start = Math.max(0, range.start - opts.radius);
    const end = Math.min(source.length, range.end + opts.radius);
    const last = windows[windows.length - 1];
    if (last && start <= last.end + opts.mergeGap) {
      last.end = Math.max(last.end, end);
    } else {
      windows.push({ start, end });
    }
  }

  const snippets: SnippetPart[][] = [];
  for (const window of windows.slice(0, opts.max)) {
    const hits = ranges.filter((range) => range.start >= window.start && range.end <= window.end);
    const parts: SnippetPart[] = [];
    let cursor = window.start;

    if (window.start > 0) parts.push({ text: '…', highlighted: false });

    for (const hit of hits) {
      if (hit.start > cursor) parts.push({ text: source.slice(cursor, hit.start), highlighted: false });
      parts.push({ text: source.slice(hit.start, hit.end), highlighted: true });
      cursor = hit.end;
    }
    if (cursor < window.end) parts.push({ text: source.slice(cursor, window.end), highlighted: false });
    if (window.end < source.length) parts.push({ text: '…', highlighted: false });

    snippets.push(parts);
  }

  return snippets;
}

/** 把分段拼回纯文本（测试/日志用） */
export function flattenSnippet(parts: readonly SnippetPart[]): string {
  return parts.map((part) => part.text).join('');
}
