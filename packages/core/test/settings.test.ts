import { createMemoryPlatform } from '@tpr/platform/memory';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DATABASE_SOURCE, REPOSITORY_URL } from '../src/repo.js';
import {
  clampWallpaperBlur,
  clampWallpaperOpacity,
  createSettings,
  DEFAULT_SETTINGS,
  DEFAULT_WALLPAPER,
  parseSettings,
  sanitizeWallpaperFile,
  wallpaperPath,
} from '../src/settings/index.js';

describe('settings: 全局设置持久化（Goal 11）', () => {
  it('settings-defaults: 文件不存在时用默认值，不抛错', async () => {
    const platform = createMemoryPlatform({ dataDir: '/app' });
    const settings = createSettings(platform);
    const loaded = await settings.load();
    expect(loaded).toEqual(DEFAULT_SETTINGS);
    expect(settings.path).toBe('/app/settings.json');
  });

  it('settings-default-source: 内置默认源指向本项目最新 Release', async () => {
    const platform = createMemoryPlatform({ dataDir: '/app' });
    const loaded = await createSettings(platform).load();
    expect(loaded.defaultSource).toBe(DEFAULT_DATABASE_SOURCE);
    expect(DEFAULT_DATABASE_SOURCE).toBe(`${REPOSITORY_URL}/releases/latest`);
  });

  it('settings-roundtrip: 保存后重开服务仍能读回（重启保留）', async () => {
    const platform = createMemoryPlatform({ dataDir: '/app' });
    const first = createSettings(platform);
    await first.load();
    await first.save({ defaultSource: 'example/tpr-db', theme: 'dark' });

    const second = createSettings(platform);
    const loaded = await second.load();
    expect(loaded.defaultSource).toBe('example/tpr-db');
    expect(loaded.theme).toBe('dark');

    const text = await platform.fs.readText('/app/settings.json');
    expect(JSON.parse(text).defaultSource).toBe('example/tpr-db');
  });

  it('settings-corrupt: 坏 JSON / 坏字段回退默认值，不让启动失败', async () => {
    const broken = createMemoryPlatform({
      dataDir: '/app',
      files: { '/app/settings.json': '{oops' },
    });
    expect((await createSettings(broken).load()).theme).toBe('system');

    const wrongTypes = createMemoryPlatform({
      dataDir: '/app',
      files: { '/app/settings.json': '{"theme":3,"language":null,"defaultSource":["x"]}' },
    });
    const loaded = await createSettings(wrongTypes).load();
    expect(loaded.theme).toBe('system');
    expect(loaded.language).toBe('zh-CN');
    expect(loaded.defaultSource).toBe(DEFAULT_DATABASE_SOURCE);
  });

  it('settings-reset: reset 删掉文件并回到默认值', async () => {
    const platform = createMemoryPlatform({ dataDir: '/app' });
    const settings = createSettings(platform);
    await settings.save({ theme: 'dark' });
    expect(await platform.fs.exists('/app/settings.json')).toBe(true);
    await settings.reset();
    expect(await platform.fs.exists('/app/settings.json')).toBe(false);
    expect(settings.get().theme).toBe('system');
  });

  it('parseSettings: 部分字段合法时保留合法值', () => {
    const parsed = parseSettings({
      theme: 'light',
      language: 'ja-JP',
      defaultSource: '  example/tpr-db  ',
      extractLimits: { maxEntries: 100, maxFileBytes: -1 },
    });
    expect(parsed?.theme).toBe('light');
    expect(parsed?.language).toBe('ja-JP');
    expect(parsed?.defaultSource).toBe('  example/tpr-db  ');
    expect(parsed?.extractLimits).toEqual({ maxEntries: 100 });
  });
});

describe('settings: 图片压缩开关（Goal 25）', () => {
  it('compress-default: 默认开启，旧设置缺字段也回退开启', async () => {
    const platform = createMemoryPlatform({ dataDir: '/app' });
    expect((await createSettings(platform).load()).compressImages).toBe(true);

    const legacy = createMemoryPlatform({
      dataDir: '/app',
      files: { '/app/settings.json': '{"theme":"dark"}' },
    });
    expect((await createSettings(legacy).load()).compressImages).toBe(true);
  });

  it('compress-roundtrip: 关闭后重启仍保持关闭', async () => {
    const platform = createMemoryPlatform({ dataDir: '/app' });
    const first = createSettings(platform);
    await first.load();
    await first.save({ compressImages: false });

    const loaded = await createSettings(platform).load();
    expect(loaded.compressImages).toBe(false);
    expect(JSON.parse(await platform.fs.readText('/app/settings.json')).compressImages).toBe(false);
  });

  it('compress-parse: 非布尔值回退默认开启', () => {
    expect(parseSettings({ compressImages: 'yes' })?.compressImages).toBe(true);
    expect(parseSettings({ compressImages: false })?.compressImages).toBe(false);
  });
});

describe('settings: 数据库自动更新开关', () => {
  it('update-check-default: 默认自动检查开启、自动导入关闭，旧设置缺字段也回退', async () => {
    const platform = createMemoryPlatform({ dataDir: '/app' });
    const loaded = await createSettings(platform).load();
    expect(loaded.autoCheckDatabaseUpdate).toBe(true);
    expect(loaded.autoImportDatabaseUpdate).toBe(false);

    const legacy = createMemoryPlatform({
      dataDir: '/app',
      files: { '/app/settings.json': '{"theme":"dark"}' },
    });
    const old = await createSettings(legacy).load();
    expect(old.autoCheckDatabaseUpdate).toBe(true);
    expect(old.autoImportDatabaseUpdate).toBe(false);
  });

  it('update-check-roundtrip: 两个开关能分别保存，重启仍保持', async () => {
    const platform = createMemoryPlatform({ dataDir: '/app' });
    const first = createSettings(platform);
    await first.load();
    await first.save({ autoCheckDatabaseUpdate: false, autoImportDatabaseUpdate: true });

    const loaded = await createSettings(platform).load();
    expect(loaded.autoCheckDatabaseUpdate).toBe(false);
    expect(loaded.autoImportDatabaseUpdate).toBe(true);
    const saved = JSON.parse(await platform.fs.readText('/app/settings.json'));
    expect(saved.autoCheckDatabaseUpdate).toBe(false);
    expect(saved.autoImportDatabaseUpdate).toBe(true);
  });

  it('update-check-parse: 非布尔值逐项回退默认值', () => {
    expect(parseSettings({ autoCheckDatabaseUpdate: 'no' })?.autoCheckDatabaseUpdate).toBe(true);
    expect(parseSettings({ autoImportDatabaseUpdate: 'yes' })?.autoImportDatabaseUpdate).toBe(false);
    expect(
      parseSettings({ autoCheckDatabaseUpdate: false, autoImportDatabaseUpdate: true }),
    ).toMatchObject({ autoCheckDatabaseUpdate: false, autoImportDatabaseUpdate: true });
  });
});

describe('settings: 外观（Goal 14）', () => {
  it('appearance-defaults: 默认 peach + 两个空壁纸槽', async () => {
    const platform = createMemoryPlatform({ dataDir: '/app' });
    const loaded = await createSettings(platform).load();
    expect(loaded.palette).toBe('peach');
    expect(loaded.wallpapers).toEqual({ home: DEFAULT_WALLPAPER, article: DEFAULT_WALLPAPER });
  });

  it('appearance-roundtrip: 配色与两处壁纸各自保存、重启读回', async () => {
    const platform = createMemoryPlatform({ dataDir: '/app' });
    const first = createSettings(platform);
    await first.load();
    await first.save({ palette: 'moon' });
    await first.save({
      wallpapers: { home: { file: 'wp-1.png', opacity: 0.7, blur: 6 } },
    });

    const loaded = await createSettings(platform).load();
    expect(loaded.palette).toBe('moon');
    expect(loaded.wallpapers.home).toEqual({ file: 'wp-1.png', opacity: 0.7, blur: 6 });
    // 只 patch home 时 article 不被覆盖
    expect(loaded.wallpapers.article).toEqual(DEFAULT_WALLPAPER);
  });

  it('appearance-parse: 非法配色回退 peach，壁纸字段逐项收敛', () => {
    const parsed = parseSettings({
      palette: 'neon',
      wallpapers: {
        home: { file: '../../etc/passwd', opacity: 9, blur: -4 },
        article: { file: 'wp-2.webp', opacity: 0.2, blur: 99 },
      },
    });
    expect(parsed?.palette).toBe('peach');
    expect(parsed?.wallpapers.home.file).toBe('');
    expect(parsed?.wallpapers.home.opacity).toBe(1);
    expect(parsed?.wallpapers.home.blur).toBe(0);
    expect(parsed?.wallpapers.article.file).toBe('wp-2.webp');
    expect(parsed?.wallpapers.article.opacity).toBe(0.2);
    expect(parsed?.wallpapers.article.blur).toBe(20);
  });

  it('wallpaper-sanitize: 只收壁纸目录里的裸文件名', () => {
    expect(sanitizeWallpaperFile('wp-171234.png')).toBe('wp-171234.png');
    expect(sanitizeWallpaperFile('a.jpg')).toBe('a.jpg');
    expect(sanitizeWallpaperFile('../a.png')).toBe('');
    expect(sanitizeWallpaperFile('C:\\a.png')).toBe('');
    expect(sanitizeWallpaperFile('a.gif')).toBe('');
    expect(sanitizeWallpaperFile('')).toBe('');
    expect(sanitizeWallpaperFile(42)).toBe('');
  });

  it('wallpaper-limits: 不透明度 0.1–1、模糊 0–20 取整', () => {
    expect(clampWallpaperOpacity(0)).toBe(0.1);
    expect(clampWallpaperOpacity(2)).toBe(1);
    expect(clampWallpaperOpacity(Number.NaN)).toBe(DEFAULT_WALLPAPER.opacity);
    expect(clampWallpaperBlur(-1)).toBe(0);
    expect(clampWallpaperBlur(7.6)).toBe(8);
    expect(clampWallpaperBlur(999)).toBe(20);
  });

  it('wallpaper-path: 拼出 app data 下的绝对路径，空名返回空串', () => {
    const platform = createMemoryPlatform({ dataDir: '/app' });
    expect(wallpaperPath(platform, 'wp-1.png')).toBe('/app/wallpapers/wp-1.png');
    expect(wallpaperPath(platform, '')).toBe('');
    expect(wallpaperPath(platform, '../x.png')).toBe('');
  });
});

describe('settings: 文章页编辑器快捷入口', () => {
  it('editor-link-default: 默认关闭，旧设置缺字段也关闭', async () => {
    const platform = createMemoryPlatform({ dataDir: '/app' });
    expect((await createSettings(platform).load()).showArticleEditorLink).toBe(false);

    const legacy = createMemoryPlatform({
      dataDir: '/app',
      files: { '/app/settings.json': '{"theme":"dark"}' },
    });
    expect((await createSettings(legacy).load()).showArticleEditorLink).toBe(false);
  });

  it('editor-link-roundtrip: 开启后重启仍保持开启', async () => {
    const platform = createMemoryPlatform({ dataDir: '/app' });
    const first = createSettings(platform);
    await first.load();
    await first.save({ showArticleEditorLink: true });

    const loaded = await createSettings(platform).load();
    expect(loaded.showArticleEditorLink).toBe(true);
    expect(JSON.parse(await platform.fs.readText('/app/settings.json')).showArticleEditorLink).toBe(true);
  });

  it('editor-link-parse: 非布尔值回退关闭，true 保留', () => {
    expect(parseSettings({ showArticleEditorLink: 'yes' })?.showArticleEditorLink).toBe(false);
    expect(parseSettings({ showArticleEditorLink: true })?.showArticleEditorLink).toBe(true);
  });
});

describe('settings: 阅读排版', () => {
  it('reading-default: 默认字体/字号/行距/段距，旧设置缺字段也回退', async () => {
    const platform = createMemoryPlatform({ dataDir: '/app' });
    expect((await createSettings(platform).load()).reading).toEqual({
      fontFamily: 'system',
      fontSize: 16,
      lineHeight: 1.85,
      paragraphSpacing: 0.9,
    });

    const legacy = createMemoryPlatform({
      dataDir: '/app',
      files: { '/app/settings.json': '{"theme":"dark"}' },
    });
    expect((await createSettings(legacy).load()).reading.fontFamily).toBe('system');
  });

  it('reading-roundtrip: 部分字段深合并后重启仍在，其余保持默认', async () => {
    const platform = createMemoryPlatform({ dataDir: '/app' });
    const first = createSettings(platform);
    await first.load();
    await first.save({ reading: { fontFamily: 'serif', fontSize: 20 } });

    const loaded = await createSettings(platform).load();
    expect(loaded.reading).toEqual({
      fontFamily: 'serif',
      fontSize: 20,
      lineHeight: 1.85,
      paragraphSpacing: 0.9,
    });
    expect(JSON.parse(await platform.fs.readText('/app/settings.json')).reading.fontSize).toBe(20);
  });

  it('reading-clamp: 越界字号/行距/段距夹紧，未知字体回退 system', () => {
    expect(
      parseSettings({
        reading: { fontFamily: 'comic', fontSize: 99, lineHeight: 0.5, paragraphSpacing: -3 },
      })?.reading,
    ).toEqual({
      fontFamily: 'system',
      fontSize: 24,
      lineHeight: 1.4,
      paragraphSpacing: 0,
    });
    expect(
      parseSettings({
        reading: { fontFamily: 'kai', fontSize: 2, lineHeight: 9, paragraphSpacing: 9 },
      })?.reading,
    ).toEqual({
      fontFamily: 'kai',
      fontSize: 14,
      lineHeight: 2.2,
      paragraphSpacing: 2,
    });
  });
});
