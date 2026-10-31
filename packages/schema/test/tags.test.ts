import { describe, expect, it } from 'vitest';
import { isR18Tag, isR18TagName, R18_TAG_NAME } from '../src/tags.js';

describe('R18 tag helpers', () => {
  it('isR18TagName 归一化大小写、全半角与空白', () => {
    expect(R18_TAG_NAME).toBe('R18');
    expect(isR18TagName('R18')).toBe(true);
    expect(isR18TagName('r18')).toBe(true);
    expect(isR18TagName('ｒ１８')).toBe(true);
    expect(isR18TagName('  R18  ')).toBe(true);
  });

  it('isR18TagName 不误判其他写法', () => {
    expect(isR18TagName('R-18')).toBe(false);
    expect(isR18TagName('R18+')).toBe(false);
    expect(isR18TagName('18')).toBe(false);
    expect(isR18TagName('')).toBe(false);
  });

  it('isR18Tag 同时识别主名与别名', () => {
    expect(isR18Tag({ name: 'R18' })).toBe(true);
    expect(isR18Tag({ name: '成人向', aliases: ['r18'] })).toBe(true);
    expect(isR18Tag({ name: '成人向', aliases: ['R-18'] })).toBe(false);
    expect(isR18Tag({ name: '一般向' })).toBe(false);
  });
});
