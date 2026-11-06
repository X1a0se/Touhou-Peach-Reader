import { describe, expect, it } from 'vitest';
import { sortByUpdatedAtDesc } from '../src/sort.js';

interface Item {
  id: string;
  updatedAt?: string;
}

describe('sort: 按修改时间倒序', () => {
  it('sort-empty: 空数组返回空数组', () => {
    expect(sortByUpdatedAtDesc([])).toEqual([]);
  });

  it('sort-desc: 修改时间最近的排在最前', () => {
    const items: Item[] = [
      { id: 'old', updatedAt: '2024-01-01T00:00:00.000Z' },
      { id: 'new', updatedAt: '2024-03-01T00:00:00.000Z' },
      { id: 'middle', updatedAt: '2024-02-01T00:00:00.000Z' },
    ];
    expect(sortByUpdatedAtDesc(items).map((item) => item.id)).toEqual(['new', 'middle', 'old']);
  });

  it('sort-missing: 没有 updatedAt 的条目排最后并保持原相对顺序', () => {
    const items: Item[] = [
      { id: 'no-1' },
      { id: 'with-time', updatedAt: '2024-01-01T00:00:00.000Z' },
      { id: 'no-2' },
    ];
    expect(sortByUpdatedAtDesc(items).map((item) => item.id)).toEqual(['with-time', 'no-1', 'no-2']);
  });

  it('sort-stable: 时间相同的条目保持原相对顺序', () => {
    const items: Item[] = [
      { id: 'first', updatedAt: '2024-01-01T00:00:00.000Z' },
      { id: 'second', updatedAt: '2024-01-01T00:00:00.000Z' },
      { id: 'third', updatedAt: '2024-01-01T00:00:00.000Z' },
    ];
    expect(sortByUpdatedAtDesc(items).map((item) => item.id)).toEqual(['first', 'second', 'third']);
  });

  it('sort-pure: 不修改入参数组与条目顺序', () => {
    const items: Item[] = [
      { id: 'old', updatedAt: '2024-01-01T00:00:00.000Z' },
      { id: 'new', updatedAt: '2024-02-01T00:00:00.000Z' },
    ];
    const sorted = sortByUpdatedAtDesc(items);
    expect(sorted).not.toBe(items);
    expect(items.map((item) => item.id)).toEqual(['old', 'new']);
  });
});
