import { customAlphabet } from 'nanoid';
import type { TagCategory } from './entities.js';

/**
 * ID 生成与归一化（design §6.2）。
 *
 * - 作者 / 标签：内容确定性 ID —— 同一个名字在任意两个库里算出同一个 id，合并才有意义。
 * - 文章 / 系列 / 图片：随机 ID —— 同名不代表同一实体。
 * - id 一旦生成永不复算；改名不换 id。
 */

export const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const nanoid = customAlphabet(ID_ALPHABET, 16);

/** 归一化：NFKC + 小写 + 折叠空白（含全角空格）+ trim */
export function normalizeName(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]+/gu, ' ')
    .trim();
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  let hex = '';
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** `p_` + sha256(归一化名) 前 12 位 */
export async function authorIdFor(canonicalName: string): Promise<string> {
  const hex = await sha256Hex(normalizeName(canonicalName));
  return `p_${hex.slice(0, 12)}`;
}

/** `t_` + sha256(category + NUL + 归一化名) 前 12 位 */
export async function tagIdFor(category: TagCategory, name: string): Promise<string> {
  const hex = await sha256Hex(`${category}\u0000${normalizeName(name)}`);
  return `t_${hex.slice(0, 12)}`;
}

export function newArticleId(): string {
  return `a_${nanoid()}`;
}
export function newSeriesId(): string {
  return `s_${nanoid()}`;
}
export function newImageId(): string {
  return `i_${nanoid()}`;
}

const DET = /^[pt]_[0-9a-f]{12}$/;
const RND = /^[asi]_[A-Za-z0-9]{16}$/;

export const isDeterministicId = (id: string): boolean => DET.test(id);
export const isRandomId = (id: string): boolean => RND.test(id);
export const isAuthorId = (id: string): boolean => id.startsWith('p_') && DET.test(id);
export const isTagId = (id: string): boolean => id.startsWith('t_') && DET.test(id);
export const isArticleId = (id: string): boolean => id.startsWith('a_') && RND.test(id);
export const isSeriesId = (id: string): boolean => id.startsWith('s_') && RND.test(id);
export const isImageId = (id: string): boolean => id.startsWith('i_') && RND.test(id);
