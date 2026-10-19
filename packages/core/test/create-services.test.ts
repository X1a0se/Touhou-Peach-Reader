import { describe, expect, it } from 'vitest';
import { createMemoryPlatform } from '@tpr/platform/memory';
import { createServices } from '../src/create.js';
import { APP_NAME, getVersion } from '../src/version.js';

describe('version', () => {
  it('返回 package.json 里的版本号', () => {
    expect(getVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('应用名与窗口标题一致（Goal 1 验收）', () => {
    expect(APP_NAME).toBe('Touhou Peach Reader');
  });
});

describe('createServices', () => {
  it('注入平台后暴露 app 服务', () => {
    const platform = createMemoryPlatform();
    const services = createServices(platform);
    expect(services.platform).toBe(platform);
    expect(services.app.getVersion()).toBe(getVersion());
    expect(services.app.getName()).toBe(APP_NAME);
  });

  it('两套 services 互不影响', () => {
    const a = createServices(createMemoryPlatform({ dataDir: '/a' }));
    const b = createServices(createMemoryPlatform({ dataDir: '/b' }));
    expect(a.platform.paths.dataDir).not.toBe(b.platform.paths.dataDir);
  });
});
