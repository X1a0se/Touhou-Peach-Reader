import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES, validateImageFile } from '../src/editor/images.js';

describe('编辑器图片校验', () => {
  it('接受常见图片格式（扩展名大小写与空 MIME 都放行）', () => {
    expect(validateImageFile({ name: 'cover.PNG', type: 'image/png', size: 1024 })).toBeNull();
    expect(validateImageFile({ name: 'a.jpg', type: '', size: 1024 })).toBeNull();
    expect(validateImageFile({ name: 'b.webp', type: 'image/webp', size: 1024 })).toBeNull();
  });

  it('拒绝非图片扩展名、SVG 与错误的 MIME', () => {
    expect(validateImageFile({ name: 'a.txt', type: 'text/plain', size: 10 })).not.toBeNull();
    expect(validateImageFile({ name: 'a.svg', type: 'image/svg+xml', size: 10 })).not.toBeNull();
    expect(validateImageFile({ name: 'a.png', type: 'text/plain', size: 10 })).not.toBeNull();
  });

  it('拒绝空文件与超过 20MB 的文件', () => {
    expect(validateImageFile({ name: 'a.png', type: 'image/png', size: 0 })).toContain('空');
    expect(
      validateImageFile({ name: 'a.png', type: 'image/png', size: MAX_IMAGE_BYTES + 1 }),
    ).toContain('20 MB');
  });
});
