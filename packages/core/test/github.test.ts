import { createMemoryPlatform } from '@tpr/platform/memory';
import type { Platform } from '@tpr/platform';
import { describe, expect, it } from 'vitest';
import {
  GitHubUrlError,
  createGitHubService,
  parseAppAsset,
  parseGitHubInput,
  pickDatabaseAsset,
  type ResolvedRelease,
} from '../src/github/index.js';

const RELEASE_JSON = {
  tag_name: 'v1.4.0',
  published_at: '2026-10-20T10:00:00Z',
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

const RELEASES_JSON = [
  {
    tag_name: 'v数据库-2026-10-20',
    html_url: 'https://github.com/example/tpr-db/releases/tag/old',
    published_at: '2026-10-20T10:00:00Z',
    draft: false,
    prerelease: false,
    assets: [
      {
        name: 'TouhouPeachReader-0.1.10-portable.exe',
        browser_download_url: 'https://example.invalid/0.1.10-portable.exe',
        size: 100,
      },
      {
        name: 'TouhouPeachReader-0.1.10-x64-setup.exe',
        browser_download_url: 'https://example.invalid/0.1.10-setup.exe',
        size: 200,
      },
    ],
  },
  {
    tag_name: 'v数据库-2026-11-01',
    html_url: 'https://github.com/example/tpr-db/releases/tag/new',
    published_at: '2026-11-01T10:00:00Z',
    draft: false,
    prerelease: false,
    assets: [
      {
        name: 'TouhouPeachReader-0.1.12-portable.exe',
        browser_download_url: 'https://example.invalid/0.1.12-portable.exe',
        size: 100,
      },
      {
        name: 'notes.txt',
        browser_download_url: 'https://example.invalid/notes.txt',
        size: 10,
      },
    ],
  },
  {
    tag_name: 'v数据库-2026-11-02',
    html_url: 'https://github.com/example/tpr-db/releases/tag/draft',
    published_at: '2026-11-02T10:00:00Z',
    draft: true,
    prerelease: false,
    assets: [
      {
        name: 'TouhouPeachReader-9.9.9-x64-setup.exe',
        browser_download_url: 'https://example.invalid/draft-setup.exe',
        size: 200,
      },
    ],
  },
];

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

  it('github-url: 中文标签与资产直链的转义编码能往返', () => {
    const tag = '纯文字文章1029-2026-10-31-121918';
    const name = 'TouhouPeachReader-DB-2026-10-31-121918.tpr';
    const tagUrl = `https://github.com/example/tpr-db/releases/tag/${encodeURIComponent(tag)}`;
    expect(parseGitHubInput(tagUrl).tag).toBe(tag);

    const assetUrl = `https://github.com/example/tpr-db/releases/download/${encodeURIComponent(tag)}/${name}`;
    const asset = parseGitHubInput(assetUrl);
    expect(asset.asset?.name).toBe(name);
    expect(asset.asset?.url).toBe(assetUrl);

    expect(() =>
      parseGitHubInput('https://github.com/example/tpr-db/releases/tag/%E0%A4%A'),
    ).toThrow(/转义编码/);
  });
});

describe('github: release 解析与下载（Goal 11）', () => {
  it('github-release: latest release 里自动挑 .tpr 资产', async () => {
    const calls: Calls = { json: [], downloads: [] };
    const platform = fakePlatform(calls);
    const service = createGitHubService(platform);
    const release = await service.resolve('example/tpr-db');
    expect(calls.json).toEqual(['https://api.github.com/repos/example/tpr-db/releases/latest']);
    expect(release.tag).toBe('v1.4.0');
    expect(release.database?.name).toBe('tpr-db-v1.4.0.tpr');
  });

  it('github-download: 资产直链不调 API，直接下载并带文件名', async () => {
    const calls: Calls = { json: [], downloads: [] };
    const platform = fakePlatform(calls);
    const service = createGitHubService(platform);
    const result = await service.download(
      'https://github.com/example/tpr-db/releases/download/v9/db.tpr',
    );
    expect(calls.json).toEqual([]);
    expect(calls.downloads).toEqual(['https://github.com/example/tpr-db/releases/download/v9/db.tpr']);
    expect(result.fileName).toBe('db.tpr');
    expect(Array.from(result.bytes)).toEqual([1, 2, 3]);
  });

  it('github-check-update: 保留当前版本原样，比较时忽略前缀 v', async () => {
    const calls: Calls = { json: [], downloads: [] };
    const platform = fakePlatform(calls);
    const service = createGitHubService(platform);
    const same = await service.checkUpdate('example/tpr-db', 'v1.4.0');
    expect(same).toMatchObject({
      current: 'v1.4.0',
      latest: '1.4.0',
      tag: 'v1.4.0',
      publishedAt: '2026-10-20T10:00:00Z',
      upToDate: true,
      assetName: 'tpr-db-v1.4.0.tpr',
      assetUrl: 'https://github.com/example/tpr-db/releases/download/v1.4.0/tpr-db-v1.4.0.tpr',
    });
    const older = await service.checkUpdate('example/tpr-db', '1.3.0');
    expect(older.upToDate).toBe(false);
    const none = await service.checkUpdate('example/tpr-db', null);
    expect(none).toMatchObject({ current: null, latest: '1.4.0', upToDate: false });
  });

  it('github-check-update: 中文时间戳标签能比较新旧，并按 tags API 编码', async () => {
    const tag = '纯文字文章1029-2026-10-31-121918';
    const current = '纯文字文章1029-2026-10-30-121918';
    const calls: Calls = { json: [], downloads: [] };
    const platform = fakePlatform(calls, {
      release: {
        tag_name: tag,
        published_at: '2026-10-31T04:19:18Z',
        assets: [
          {
            name: 'TouhouPeachReader-DB-2026-10-31-121918.tpr',
            browser_download_url: 'https://example.invalid/db.tpr',
            size: 4096,
          },
        ],
      },
    });
    const service = createGitHubService(platform);
    const result = await service.checkUpdate(
      `https://github.com/example/tpr-db/releases/tag/${encodeURIComponent(tag)}`,
      current,
      { localUpdatedAt: '2026-10-30T12:19:18Z' },
    );
    expect(calls.json).toEqual([
      `https://api.github.com/repos/example/tpr-db/releases/tags/${encodeURIComponent(tag)}`,
    ]);
    expect(result).toMatchObject({ current, latest: tag, tag, upToDate: false });
    expect((await service.checkUpdate('example/tpr-db', tag)).upToDate).toBe(true);
  });

  it('github-no-asset: release 里没有包时报 E_NO_ASSET 并列出资产名', async () => {
    const calls: Calls = { json: [], downloads: [] };
    const platform = fakePlatform(calls, {
      release: { tag_name: 'v1.0.0', assets: [{ name: 'readme.md', browser_download_url: 'https://x/y' }] },
    });
    const service = createGitHubService(platform);
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

  it('github-check-app-update: 从安装包资产名解析最新程序版本，忽略草稿', async () => {
    const calls: Calls = { json: [], downloads: [] };
    const platform = fakePlatform(calls, { release: RELEASES_JSON });
    const service = createGitHubService(platform);

    const result = await service.checkAppUpdate('example/tpr-db', '0.1.10');
    expect(calls.json).toEqual([
      'https://api.github.com/repos/example/tpr-db/releases?per_page=30',
    ]);
    expect(result).toMatchObject({
      current: '0.1.10',
      latest: '0.1.12',
      upToDate: false,
      releaseUrl: 'https://github.com/example/tpr-db/releases/tag/new',
      publishedAt: '2026-11-01T10:00:00Z',
      portable: {
        kind: 'portable',
        name: 'TouhouPeachReader-0.1.12-portable.exe',
        url: 'https://example.invalid/0.1.12-portable.exe',
      },
      setup: null,
    });

    expect((await service.checkAppUpdate('example/tpr-db', '0.1.12')).upToDate).toBe(true);
    expect((await service.checkAppUpdate('example/tpr-db', '0.1.9')).upToDate).toBe(false);
  });

  it('parseAppAsset: 只认程序安装包命名', () => {
    expect(parseAppAsset('TouhouPeachReader-0.1.12-x64-setup.exe')).toEqual({
      version: '0.1.12',
      kind: 'setup',
    });
    expect(parseAppAsset('TouhouPeachReader-1.0.0-portable.exe')).toEqual({
      version: '1.0.0',
      kind: 'portable',
    });
    expect(parseAppAsset('TouhouPeachReader-DB-2026-11-01.tpr')).toBeNull();
    expect(parseAppAsset('other-1.0.0-portable.exe')).toBeNull();
  });
});
