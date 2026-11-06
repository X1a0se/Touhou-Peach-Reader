/**
 * 按 updatedAt 倒序排列（最近修改的靠上）。
 *
 * - 不修改入参；
 * - ISO 8601 UTC 字符串可直接字典序比较；
 * - 没有 updatedAt 的条目排在最后，并保持原有相对顺序；
 * - 时间相同也保持原有相对顺序，避免列表在编辑后无谓跳动。
 */
export function sortByUpdatedAtDesc<T extends { updatedAt?: string | undefined }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const left = a.item.updatedAt;
      const right = b.item.updatedAt;
      if (left !== undefined && right !== undefined) {
        if (left < right) return 1;
        if (left > right) return -1;
        return a.index - b.index;
      }
      if (left !== undefined) return -1;
      if (right !== undefined) return 1;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}
