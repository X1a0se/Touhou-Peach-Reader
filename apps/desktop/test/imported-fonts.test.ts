import { DEFAULT_READING_TYPOGRAPHY } from '@tpr/core';
import { describe, expect, it } from 'vitest';
import {
  MAX_FONT_BYTES,
  READING_FONT_STACKS,
  fontFormatForName,
  fontSignatureMatches,
  fontStack,
  validateFontFile,
} from '../src/fonts/fonts.js';

describe('fonts/imported: 本地字体校验与字体栈', () => {
  it('font-format: 按扩展名识别支持的四种格式', () => {
    expect(fontFormatForName('霞鹜文楷.ttf')).toBe('ttf');
    expect(fontFormatForName('FONT.OTF')).toBe('otf');
    expect(fontFormatForName('font.woff')).toBe('woff');
    expect(fontFormatForName('font.woff2')).toBe('woff2');
    expect(fontFormatForName('font.ttc')).toBeNull();
    expect(fontFormatForName('font')).toBeNull();
  });

  it('font-validate: 拒绝未知扩展名、空文件与超大文件', () => {
    expect(validateFontFile({ name: 'font.ttf', size: 1024 })).toBeNull();
    expect(validateFontFile({ name: 'font.bin', size: 1024 })).toContain('只支持');
    expect(validateFontFile({ name: 'font.ttf', size: 0 })).toContain('为空');
    expect(validateFontFile({ name: 'font.ttf', size: MAX_FONT_BYTES + 1 })).toContain('20 MB');
  });

  it('font-signature: 校验文件头与扩展名一致', () => {
    const ttf = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x00, 0x00]);
    const otf = new Uint8Array([0x4f, 0x54, 0x54, 0x4f, 0x00, 0x00]);
    const woff = new Uint8Array([0x77, 0x4f, 0x46, 0x46, 0x00, 0x00]);
    const woff2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0x00, 0x00]);
    expect(fontSignatureMatches(ttf, 'ttf')).toBe(true);
    expect(fontSignatureMatches(otf, 'otf')).toBe(true);
    expect(fontSignatureMatches(woff, 'woff')).toBe(true);
    expect(fontSignatureMatches(woff2, 'woff2')).toBe(true);
    expect(fontSignatureMatches(ttf, 'woff2')).toBe(false);
    expect(fontSignatureMatches(new Uint8Array([0x00]), 'ttf')).toBe(false);
  });

  it('font-stack: 选中本地字体时优先，否则用预设栈', () => {
    expect(fontStack(DEFAULT_READING_TYPOGRAPHY)).toBe(READING_FONT_STACKS.system);
    const custom = fontStack({ ...DEFAULT_READING_TYPOGRAPHY, customFontId: 'font_alpha' });
    expect(custom.startsWith('"TPR Imported font_alpha"')).toBe(true);
    expect(custom).toContain(READING_FONT_STACKS.system);
  });
});
