import { describe, expect, it } from 'vitest';
import { readingProgress, scrollTargetForProgress } from '../src/reading/progress.js';

describe('正文阅读进度', () => {
  it('只按正文范围计算，顶部为 0、底部为 1，并夹紧越界值', () => {
    expect(readingProgress(100, 100, 1100, 500)).toBe(0);
    expect(readingProgress(400, 100, 1100, 500)).toBe(0.5);
    expect(readingProgress(700, 100, 1100, 500)).toBe(1);
    expect(readingProgress(-40, 100, 1100, 500)).toBe(0);
    expect(readingProgress(5000, 100, 1100, 500)).toBe(1);
  });

  it('正文短于一屏时视为已读完', () => {
    expect(readingProgress(0, 100, 400, 500)).toBe(1);
    expect(scrollTargetForProgress(0.5, 100, 400, 500)).toBe(100);
  });

  it('进度与滚动目标可以往返换算', () => {
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const scrollY = scrollTargetForProgress(progress, 120, 1120, 640);
      expect(readingProgress(scrollY, 120, 1120, 640)).toBeCloseTo(progress, 6);
    }
  });
});
