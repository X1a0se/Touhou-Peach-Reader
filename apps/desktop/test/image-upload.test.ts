import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  type ImageTranscoder,
  type PreparedImageUpload,
  prepareImageUpload,
  uploadNotice,
} from '../src/editor/image-upload.js';

function fakeFile(name: string, type: string, bytes: Uint8Array): File {
  return {
    name,
    type,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.slice().buffer,
  } as unknown as File;
}

function encoded(size: number, ext = 'webp'): { bytes: Uint8Array; ext: string } {
  return { bytes: new Uint8Array(size), ext };
}

describe('图片上传压缩（Goal 25）', () => {
  it('关闭压缩时原样保存，不调用转码器', async () => {
    let called = false;
    const transcode: ImageTranscoder = async () => {
      called = true;
      return encoded(100);
    };
    const bytes = new Uint8Array(4096).fill(7);
    const result = await prepareImageUpload(
      fakeFile('a.PNG', 'image/png', bytes),
      false,
      transcode,
    );

    expect(called).toBe(false);
    expect(result.compressed).toBe(false);
    expect(result.reason).toBe('disabled');
    expect(result.ext).toBe('png');
    expect(result.bytes).toEqual(bytes);
    expect(result.originalSize).toBe(4096);
    expect(result.outputSize).toBe(4096);
  });

  it('GIF/WebP 不转码，保留原扩展名', async () => {
    const gif = await prepareImageUpload(
      fakeFile('a.gif', 'image/gif', new Uint8Array(4096)),
      true,
      async () => {
        throw new Error('不应调用');
      },
    );
    expect(gif.reason).toBe('format');
    expect(gif.ext).toBe('gif');
    expect(gif.compressed).toBe(false);

    const webp = await prepareImageUpload(
      fakeFile('a.webp', 'image/webp', new Uint8Array(4096)),
      true,
      async () => encoded(100),
    );
    expect(webp.reason).toBe('format');
    expect(webp.ext).toBe('webp');
    expect(webp.outputSize).toBe(4096);
  });

  it('压缩后明显变小才采用 WebP 结果', async () => {
    const result = await prepareImageUpload(
      fakeFile('photo.jpeg', 'image/jpeg', new Uint8Array(100_000)),
      true,
      async () => encoded(40_000),
    );

    expect(result.compressed).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.ext).toBe('webp');
    expect(result.originalSize).toBe(100_000);
    expect(result.outputSize).toBe(40_000);
    expect(result.bytes.byteLength).toBe(40_000);
  });

  it('节省字节或比例不足时保留原图', async () => {
    const smallSaving = await prepareImageUpload(
      fakeFile('a.png', 'image/png', new Uint8Array(10_000)),
      true,
      async () => encoded(9_900),
    );
    expect(smallSaving.reason).toBe('no-gain');
    expect(smallSaving.compressed).toBe(false);
    expect(smallSaving.outputSize).toBe(10_000);

    const smallRatio = await prepareImageUpload(
      fakeFile('a.png', 'image/png', new Uint8Array(100_000)),
      true,
      async () => encoded(96_000),
    );
    expect(smallRatio.reason).toBe('no-gain');
    expect(smallRatio.bytes.byteLength).toBe(100_000);
  });

  it('转码失败或输出不是 WebP 时回退原图', async () => {
    const failed = await prepareImageUpload(
      fakeFile('a.png', 'image/png', new Uint8Array(4096)),
      true,
      async () => {
        throw new Error('canvas unavailable');
      },
    );
    expect(failed.reason).toBe('failed');
    expect(failed.compressed).toBe(false);
    expect(failed.bytes.byteLength).toBe(4096);

    const wrongFormat = await prepareImageUpload(
      fakeFile('a.png', 'image/png', new Uint8Array(4096)),
      true,
      async () => encoded(100, 'png'),
    );
    expect(wrongFormat.reason).toBe('failed');
  });

  it('先跑现有格式校验；不合法文件直接抛中文错误', async () => {
    await expect(
      prepareImageUpload(fakeFile('a.svg', 'image/svg+xml', new Uint8Array(10)), true),
    ).rejects.toThrow('PNG');
  });

  it('字节格式化与成功提示覆盖压缩/回退场景', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(4 * 1024 * 1024)).toBe('4.0 MB');

    const compressed: PreparedImageUpload = {
      bytes: new Uint8Array(2048),
      ext: 'webp',
      originalSize: 4096,
      outputSize: 2048,
      compressed: true,
      reason: null,
    };
    expect(uploadNotice(compressed, 'a.png')).toBe('已上传：a.png（已压缩 4.0 KB → 2.0 KB）');
    expect(uploadNotice(compressed, 'a.png', '已上传并选中')).toContain('已上传并选中：a.png');

    const disabled: PreparedImageUpload = {
      ...compressed,
      compressed: false,
      reason: 'disabled',
    };
    expect(uploadNotice(disabled, 'a.png')).toContain('压缩已关闭');
  });
});
