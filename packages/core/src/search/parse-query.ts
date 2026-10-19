/**
 * 查询串解析（design §11.5）。
 *
 * - `#已完结` / `#连载中` / `#短篇文` / `#系列文` → 虚拟标签
 * - `#标签名` → 角色/情节/主题标签的精确名
 * - `"精确短语"` → 整串作为一个 token
 * - 其余按空白切成关键词
 */

export interface ParsedQuery {
  /** 普通关键词（未分词） */
  terms: string[];
  /** 引号内的精确短语 */
  phrases: string[];
  /** 虚拟标签，如 `v:completed` */
  virtualTags: string[];
  /** `#标签名` 归一化后的标签名 */
  tagNames: string[];
}

const VIRTUAL_ALIASES: Record<string, string> = {
  已完结: 'v:completed',
  完结: 'v:completed',
  completed: 'v:completed',
  连载中: 'v:ongoing',
  ongoing: 'v:ongoing',
  短篇文: 'v:short',
  短篇: 'v:short',
  系列文: 'v:series-entry',
  系列条目: 'v:series-entry',
  系列: 'v:series-entry',
};

export interface VirtualTagLabel {
  readonly name: string;
  readonly description: string;
}

/** 搜索框 `#` 联想的虚拟标签（显示用，顺序即推荐顺序） */
export const VIRTUAL_TAG_LABELS: readonly VirtualTagLabel[] = [
  { name: '已完结', description: '系列已完结' },
  { name: '连载中', description: '系列连载中' },
  { name: '短篇文', description: '只看短篇' },
  { name: '系列文', description: '只看系列条目' },
];

/** 归一化标签名：NFKC + 小写 + 去首尾空白（与 ids.normalizeName 对齐） */
export function normalizeTagName(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/[\s\u3000]+/gu, ' ').trim();
}

export function parseQuery(query: string): ParsedQuery {
  const terms: string[] = [];
  const phrases: string[] = [];
  const virtualTags: string[] = [];
  const tagNames: string[] = [];

  const text = query.normalize('NFKC');
  let index = 0;

  while (index < text.length) {
    const char = text[index] ?? '';
    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }
    if (char === '"' || char === '“') {
      const close = text.indexOf(char === '“' ? '”' : '"', index + 1);
      const end = close === -1 ? text.length : close;
      const phrase = text.slice(index + 1, end).trim();
      if (phrase) phrases.push(phrase);
      index = end + 1;
      continue;
    }
    if (char === '#') {
      let end = index + 1;
      while (end < text.length && !/[\s#"]/u.test(text[end] ?? '')) end += 1;
      const name = text.slice(index + 1, end).trim();
      if (name) {
        const virtual = VIRTUAL_ALIASES[name] ?? VIRTUAL_ALIASES[name.toLowerCase()];
        if (virtual) virtualTags.push(virtual);
        else tagNames.push(normalizeTagName(name));
      }
      index = end;
      continue;
    }
    let end = index;
    while (end < text.length && !/[\s#"“]/u.test(text[end] ?? '')) end += 1;
    const term = text.slice(index, end).trim();
    if (term) terms.push(term);
    index = end;
  }

  return { terms, phrases, virtualTags, tagNames };
}

export function isEmptyQuery(parsed: ParsedQuery): boolean {
  return (
    parsed.terms.length === 0 &&
    parsed.phrases.length === 0 &&
    parsed.virtualTags.length === 0 &&
    parsed.tagNames.length === 0
  );
}
