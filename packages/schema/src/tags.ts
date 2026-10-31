import { normalizeName } from './ids.js';

export const R18_TAG_NAME = 'R18';

const R18_NORMALIZED = normalizeName(R18_TAG_NAME);

/** 名称在归一化后是否就是情节标签 R18（大小写、全半角、空白不敏感）。 */
export function isR18TagName(name: string): boolean {
  return normalizeName(name) === R18_NORMALIZED;
}

export interface R18TagLike {
  name: string;
  aliases?: readonly string[] | undefined;
}

/** 主名或任一别名是 R18 时返回 true。 */
export function isR18Tag(tag: R18TagLike): boolean {
  if (isR18TagName(tag.name)) return true;
  return (tag.aliases ?? []).some((alias) => isR18TagName(alias));
}
