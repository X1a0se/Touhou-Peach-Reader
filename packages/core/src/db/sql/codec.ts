import type { SqlRow } from '@tpr/platform';
import type { RawDatabase } from '@tpr/schema';

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp',
};

/** 用图片路径的扩展名生成给 <img> / custom protocol 的 MIME。 */
export function mimeOf(file: string): string {
  const name = file.slice(file.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

export function rowText(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`数据库行缺少文本列 ${key}`);
  return value;
}

export function rowNullableText(row: SqlRow, key: string): string | undefined {
  const value = row[key];
  return typeof value === 'string' ? value : undefined;
}

export function rowInt(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`数据库行缺少整数列 ${key}`);
  }
  return value;
}

export function rowBool(row: SqlRow, key: string): boolean {
  return rowInt(row, key) !== 0;
}

/** 稳定 JSON：对象键排序、数组顺序保留，用于比较两次状态是否等价。 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return item;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(item).sort()) {
      sorted[key] = (item as Record<string, unknown>)[key];
    }
    return sorted;
  });
}

/** 忽略 filePaths（磁盘扫描缓存，不属于数据库内容）。 */
export function canonicalDatabase(db: RawDatabase): string {
  const { filePaths: _filePaths, ...rest } = db;
  return stableStringify(rest);
}
