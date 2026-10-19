import { createMemoryPlatform } from '@tpr/platform/memory';
import type { Platform } from '@tpr/platform';
import { describe, expect, it } from 'vitest';
import {
  GitHubUrlError,
  createGitHubService,
  parseGitHubInput,
  pickDatabaseAsset,
  type ResolvedRelease,
} from '../src/github/index.js';
import { applyMirrorPrefix, createSettings } from '../src/settings/index.js';

const RELEASE_JSON = {
  tag_name: 'v1.4.0',
  assets: [
    {
      name: 'notes.txt',
      browser_download_url: 'https://github.com/example/tpr-db/releases/download/v1.4.0/notes.txt',
      size: 12,
    },
    {
      name: 'tpr-db-v1.4.0.tpr',
      browser_download_url: 'https://github.com/example/tpr-db/releases/download/v1.4.0/tpr-db-v1.4.0.tpr',
      size: 4096,
    },
  ],
};

interface Calls {
  json: string[];
  downloads: string[];
}

function fakePlatform(calls: Calls, opts: { release?: unknown; bytes?: Uint8Array } = {}): Platform {
  const platform = createMemoryPlatform({
    dataDir: '/app',
    network: {
      fetchJson: async <T>(url: string) => {
        calls.json.push(url);
        return (opts.release ?? RELEASE_JSON) as T;
      },
      download: async (url: string) => {
        calls.downloads.push(url);
        return opts.bytes ?? new Uint8Array([1, 2, 3]);
      },
    },
  });
  return platform;
}

describe('github: URL 解析（Goal 11）', () => {
  it('github-url: 仓库首页 / release / tag / 资产直链 / 速记 都能解析', () => {
    expect(parseGitHubInput('https://github.com/example/tpr-db')).toMatchObject({
      owner: 'example',
      repo: 'tpr-db',
    });
    expect(parseGitHubInput('https://github.com/example/tpr-db/')).toMatchObject({
      owner: 'example',
      repo: 'tpr-db',
    });
    expect(parseGitHubInput('https://github.com/example/tpr-db/releases')).toMatchObject({
      owner: 'example',
      repo: 'tpr-db',
    });
    expect(parseGitHubInput('https://github.com/example/tpr-db/releases/latest')).toMatchObject({
      owner: 'example',
      repo: 'tpr-db',
    });
    expect(parseGitHubInput('https://github.com/example/tpr-db/releases/tag/v1.2.3')).toMatchObject({
      owner: 'example',
      repo: 'tpr-db',
      tag: 'v1.2.3',
    });
    expect(
      parseGitHubInput('https://github.com/example/tpr-db/releases/download/v1.2.3/db.tpr'),
    ).toMatchObject({
      owner: 'example',
      repo: 'tpr-db',
      tag: 'v1.2.3',
      asset: {
        name: 'db.tpr',
        url: 'https://github.com/example/tpr-db/releases/download/v1.2.3/db.tpr',
      },
    });
    expect(parseGitHubInput('example/tpr-db')).toMatchObject({ owner: 'example', repo: 'tpr-db' });
  });

  it('github-url: 非 github 域、空输入、非法子路径都报 E_GITHUB_URL / E_GITHUB_HOST', () => {
    expect(() => parseGitHubInput('')).toThrow(GitHubUrlError);
    expect(() => parseGitHubInput('https://gitlab.com/example/tpr-db')).toThrow(/只支持 github\.com/);
    expect(() => parseGitHubInput('https://github.com/example/tpr-db/tree/main')).toThrow(/release/);
    expect(() => parseGitHubInput('https://github.com/example/tpr-db/releases/tag/')).toThrow(/tag/);
    expect(() => parseGitHubInput('not a url')).toThrow(/无法识别/);
  });
});

describe('github: release 解析与下载（Goal 11）', () => {
  it('github-release: latest release 里自动挑 .tpr 资产', async () => {
    const calls: Calls = { json: [], downloads: [] };
    const platform = fakePlatform(calls);
    const service = createGitHubService(platform, createSettings(platform));
    const release = await service.resolve('example/tpr-db');
    expect(calls.json).toEqual(['https://api.github.com/repos/example/tpr-db/releases/latest']);
    expect(release.tag).toBe('v1.4.0');
    expect(release.database?.name).toBe('tpr-db-v1.4.0.tpr');
  });

  it('github-download: 资产直链不调 API，直接下载并带文件名', async () => {
    const calls: Calls = { json: [], downloads: [] };
    const platform = fakePlatform(calls);
    const service = createGitHubService(platform, createSettings(platform));
    const result = await service.download(
      'https://github.com/example/tpr-db/releases/download/v9/db.tpr',
    );
    expect(calls.json).toEqual([]);
    expect(calls.downloads).toEqual(['https://github.com/example/tpr-db/releases/download/v9/db.tpr']);
    expect(result.fileName).toBe('db.tpr');
    expect(Array.from(result.bytes)).toEqual([1, 2, 3]);
  });

  it('github-mirror: 设置镜像前缀后下载地址被改写，API 仍直连', async () => {
    const calls: Calls = { json: [], downloads: [] };
    const platform = fakePlatform(calls);
    const settings = createSettings(platform);
    await settings.load();
    await settings.save({ mirrorPrefix: 'https://mirror.example/gh/' });
    const service = createGitHubService(platform, settings);
    await service.download('example/tpr-db');
    expect(calls.json[0]).toBe('https://api.github.com/repos/example/tpr-db/releases/latest');
    expect(calls.downloads[0]).toBe(
      'https://mirror.example/gh/https://github.com/example/tpr-db/releases/download/v1.4.0/tpr-db-v1.4.0.tpr',
    );
  });

  it('github-check-update: 比对 manifest 版本，忽略前缀 v', async () => {
    const calls: Calls = { json: [], downloads: [] };
    const platform = fakePlatform(calls);
    const settings = createSettings(platform);
    const service = createGitHubService(platform, settings);
    const same = await service.checkUpdate('example/tpr-db', 'v1.4.0');
    expect(same).toMatchObject({ current: '1.4.0', latest: '1.4.0', upToDate: true });
    const older = await service.checkUpdate('example/tpr-db', '1.3.0');
    expect(older.upToDate).toBe(false);
    const none = await service.checkUpdate('example/tpr-db', null);
    expect(none.upToDate).toBe(false);
  });

  it('github-no-asset: release 里没有包时报 E_NO_ASSET 并列出资产名', async () => {
    const calls: Calls = { json: [], downloads: [] };
    const platform = fakePlatform(calls, {
      release: { tag_name: 'v1.0.0', assets: [{ name: 'readme.md', browser_download_url: 'https://x/y' }] },
    });
    const service = createGitHubService(platform, createSettings(platform));
    await expect(service.download('example/tpr-db')).rejects.toThrow(/没有 .tpr 或 .zip/);
  });

  it('pickDatabaseAsset: .tpr 优先于 .zip', () => {
    const picked = pickDatabaseAsset([
      { name: 'a.zip', url: 'https://x/a.zip', size: 1 },
      { name: 'b.tpr', url: 'https://x/b.tpr', size: 2 },
      { name: 'c.tpr', url: 'https://x/c.tpr', size: 3 },
    ] as unknown as ResolvedRelease['assets']);
    expect(picked?.name).toBe('b.tpr');
  });

  it('applyMirrorPrefix: 空前缀直连，尾斜杠归一', () => {
    expect(applyMirrorPrefix('https://a/b', '')).toBe('https://a/b');
    expect(applyMirrorPrefix('https://a/b', 'https://m/')).toBe('https://m/https://a/b');
    expect(applyMirrorPrefix('https://a/b', 'https://m')).toBe('https://m/https://a/b');
  });
});
