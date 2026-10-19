import { createMemoryPlatform } from '@tpr/platform/memory';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  applyMirrorPrefix,
  createSettings,
  parseSettings,
} from '../src/settings/index.js';

describe('settings: 全局设置持久化（Goal 11）', () => {
  it('settings-defaults: 文件不存在时用默认值，不抛错', async () => {
    const platform = createMemoryPlatform({ dataDir: '/app' });
    const settings = createSettings(platform);
    const loaded = await settings.load();
    expect(loaded).toEqual(DEFAULT_SETTINGS);
    expect(settings.path).toBe('/app/settings.json');
  });

  it('settings-roundtrip: 保存后重开服务仍能读回（重启保留）', async () => {
    const platform = createMemoryPlatform({ dataDir: '/app' });
    const first = createSettings(platform);
    await first.load();
    await first.save({ defaultSource: 'example/tpr-db', theme: 'dark', mirrorPrefix: 'https://m/' });

    const second = createSettings(platform);
    const loaded = await second.load();
    expect(loaded.defaultSource).toBe('example/tpr-db');
    expect(loaded.theme).toBe('dark');
    expect(loaded.mirrorPrefix).toBe('https://m/');

    const text = await platform.fs.readText('/app/settings.json');
    expect(JSON.parse(text).defaultSource).toBe('example/tpr-db');
  });

  it('settings-corrupt: 坏 JSON / 坏字段回退默认值，不让启动失败', async () => {
    const broken = createMemoryPlatform({ dataDir: '/app', files: { '/app/settings.json': '{oops' } });
    expect((await createSettings(broken).load()).theme).toBe('system');

    const wrongTypes = createMemoryPlatform({
      dataDir: '/app',
      files: { '/app/settings.json': '{"theme":3,"language":null,"defaultSource":["x"]}' },
    });
    const loaded = await createSettings(wrongTypes).load();
    expect(loaded.theme).toBe('system');
    expect(loaded.language).toBe('zh-CN');
    expect(loaded.defaultSource).toBe('');
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

  it('applyMirrorPrefix: 与下载器共用同一拼装规则', () => {
    expect(applyMirrorPrefix('https://github.com/a/b', '')).toBe('https://github.com/a/b');
    expect(applyMirrorPrefix('https://github.com/a/b', 'https://m/gh')).toBe(
      'https://m/gh/https://github.com/a/b',
    );
  });
});
