import { describe, expect, it } from 'vitest';
import { canGoBack } from '../src/navigation.js';

describe('返回上一页判定', () => {
  it('只有应用内历史（idx > 0）才后退', () => {
    expect(canGoBack({ idx: 2 })).toBe(true);
    expect(canGoBack({ idx: 1 })).toBe(true);
    expect(canGoBack({ idx: 0 })).toBe(false);
    expect(canGoBack({ idx: '1' })).toBe(false);
    expect(canGoBack({ idx: 1.5 })).toBe(false);
    expect(canGoBack(null)).toBe(false);
    expect(canGoBack({})).toBe(false);
  });
});
