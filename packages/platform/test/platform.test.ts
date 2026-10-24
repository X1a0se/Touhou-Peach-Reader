import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { PlatformError } from '../src/errors.js';
import { createMemoryPlatform } from '../src/memory/index.js';
import { safeEntryPath } from '../src/security.js';

describe('InMemoryFileSystem', () => {
  it('读写文本与字节', async () => {
    const { fs } = createMemoryPlatform();
    await fs.writeText('/a/b.txt', '你好');
    expect(await fs.readText('/a/b.txt')).toBe('你好');
    expect((await fs.readBytes('/a/b.txt')).byteLength).toBe(6);
    expect(await fs.exists('/a/b.txt')).toBe(true);
    expect(await fs.exists('/a')).toBe(true);
  });

  it('listDir 区分文件与目录', async () => {
    const { fs } = createMemoryPlatform();
    await fs.writeText('/a/b.txt', 'x');
    await fs.writeText('/a/c/d.txt', 'y');
    const entries = await fs.listDir('/a');
    expect(entries.map((e) => e.name).sort()).toEqual(['b.txt', 'c']);
    expect(entries.find((e) => e.name === 'c')?.isDirectory).toBe(true);
  });

  it('rename 覆盖同名文件、移动目录', async () => {
    const { fs } = createMemoryPlatform();
    await fs.writeText('/a/x.txt', 'x');
    await fs.writeText('/a/x.txt.tmp', 'y');
    await fs.rename('/a/x.txt.tmp', '/a/x.txt');
    expect(await fs.readText('/a/x.txt')).toBe('y');

    await fs.rename('/a', '/b');
    expect(await fs.exists('/a/x.txt')).toBe(false);
    expect(await fs.readText('/b/x.txt')).toBe('y');
  });

  it('未递归删除非空目录会报 ENOTEMPTY', async () => {
    const { fs } = createMemoryPlatform();
    await fs.writeText('/a/b.txt', 'x');
    await expect(fs.remove('/a')).rejects.toBeInstanceOf(PlatformError);
    await fs.remove('/a', { recursive: true });
    expect(await fs.exists('/a')).toBe(false);
  });
});

describe('MemoryWallpapers', () => {
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);

  it('导入后给出 data URL，删除后返回空串', async () => {
    const platform = createMemoryPlatform();
    await platform.fs.writeBytes('/tmp/w.png', png);
    const imported = await platform.wallpapers.importFile('/tmp/w.png');
    expect(imported.bytes).toBe(png.byteLength);
    expect(platform.wallpapers.toUrl(imported.fileName)).toMatch(/^data:image\/png;base64,/);

    await platform.wallpapers.remove(imported.fileName);
    expect(platform.wallpapers.toUrl(imported.fileName)).toBe('');
  });

  it('拒绝不支持的扩展名与超限文件', async () => {
    const platform = createMemoryPlatform();
    await platform.fs.writeBytes('/tmp/w.bmp', png);
    await expect(platform.wallpapers.importFile('/tmp/w.bmp')).rejects.toBeInstanceOf(PlatformError);

    const huge = new Uint8Array(20 * 1024 * 1024 + 1);
    await platform.fs.writeBytes('/tmp/big.png', huge);
    await expect(platform.wallpapers.importFile('/tmp/big.png')).rejects.toBeInstanceOf(PlatformError);
  });

  it('空文件名返回空 URL', () => {
    const platform = createMemoryPlatform();
    expect(platform.wallpapers.toUrl('')).toBe('');
  });
});

describe('safeEntryPath', () => {
  it('拒绝 zip-slip 与绝对路径', () => {
    expect(safeEntryPath('../etc/passwd').ok).toBe(false);
    expect(safeEntryPath('a/../../b').ok).toBe(false);
    expect(safeEntryPath('/etc/passwd').ok).toBe(false);
    expect(safeEntryPath('C:/windows').ok).toBe(false);
    expect(safeEntryPath('a/b/c.json')).toEqual({ ok: true, path: 'a/b/c.json' });
  });
});

describe('FflateZip', () => {
  it('打包再解包，内容一致', async () => {
    const { fs, zip } = createMemoryPlatform();
    await fs.writeText('/data/articles/a.json', '{"id":"a"}');
    await fs.writeText('/data/manifest.json', '{}');

    const created = await zip.createFromDir('/data', '/out.tpr', { order: ['manifest.json'] });
    expect(created.entries).toBe(2);

    const extracted = await zip.extractAll('/out.tpr', '/restore');
    expect(extracted.entries).toBe(2);
    expect(extracted.rejected).toEqual([]);
    expect(await fs.readText('/restore/articles/a.json')).toBe('{"id":"a"}');
    expect(await fs.readText('/restore/manifest.json')).toBe('{}');
  });

  it('createFromDirTo 直接写指定目标，内容可解压', async () => {
    const { fs, zip } = createMemoryPlatform();
    await fs.writeText('/data/articles/a.json', '{"id":"a"}');
    await fs.writeText('/data/manifest.json', '{}');
    await fs.writeText('/direct.tpr', 'old');

    const created = await zip.createFromDirTo('/data', '/direct.tpr', { order: ['manifest.json'] });
    expect(created.entries).toBe(2);

    const extracted = await zip.extractAll('/direct.tpr', '/restore');
    expect(extracted.entries).toBe(2);
    expect(extracted.rejected).toEqual([]);
    expect(await fs.readText('/restore/articles/a.json')).toBe('{"id":"a"}');
  });

  it('拒绝越界条目并记录 rejected，不中断整体', async () => {
    const { fs, zip } = createMemoryPlatform();
    const bytes = zipSync({
      'ok.txt': new TextEncoder().encode('ok'),
      '../evil.txt': new TextEncoder().encode('evil'),
    });
    const result = await zip.extractBytes(bytes, '/dest');
    expect(result.entries).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(await fs.readText('/dest/ok.txt')).toBe('ok');
    expect(await fs.exists('/evil.txt')).toBe(false);
  });
});
