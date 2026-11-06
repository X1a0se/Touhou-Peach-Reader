/**
 * GitHub release 解析与下载（design §11.7 / Goal 11）。
 *
 * 只读公开仓库：release API + 资产直链，全部走 `INetwork`（浏览器 fetch / Tauri WebView），
 * 不新增 Rust 依赖；API 与下载都直连。
 */

import type { Platform } from '@tpr/platform';
import { REPOSITORY_APP } from '../repo.js';
import type { GitHubRef } from './url.js';
import { parseGitHubInput } from './url.js';
import { isNewerAppVersion, isNewerDatabaseVersion } from './version.js';

export interface GitHubAsset {
  readonly name: string;
  readonly url: string;
  readonly size: number;
}

export interface ResolvedRelease {
  readonly owner: string;
  readonly repo: string;
  readonly tag: string;
  /** GitHub 的 release 发布时间；资产直链解析时为 null */
  readonly publishedAt: string | null;
  readonly assets: readonly GitHubAsset[];
  /** 自动挑中的数据库资产（`.tpr` 优先，其次 `.zip`；都没有为 null） */
  readonly database: GitHubAsset | null;
}

export interface DownloadedDatabase {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly tag: string;
  readonly release: ResolvedRelease;
}

export interface UpdateCheck {
  readonly owner: string;
  readonly repo: string;
  /** 当前库的 manifest.version（原样返回）；未导入库时为 null */
  readonly current: string | null;
  /** release 标签（保留 v 前缀，下载时要用原始标签） */
  readonly tag: string;
  readonly latest: string;
  readonly publishedAt: string | null;
  readonly upToDate: boolean;
  readonly assetName: string | null;
  /** 数据库资产直链；下载时可直接使用，避免第二次 API 请求。 */
  readonly assetUrl: string | null;
}

export interface AppUpdateAsset {
  readonly kind: 'portable' | 'setup';
  readonly name: string;
  readonly url: string;
}

/**
 * 程序本体更新检查结果。
 *
 * 注意 release 的 tag 是数据库版本，应用版本只存在于安装包资产名里，
 * 所以这里不能复用 `UpdateCheck.latest`（数据库版本）。
 */
export interface AppUpdateCheck {
  readonly owner: string;
  readonly repo: string;
  readonly current: string | null;
  readonly latest: string;
  readonly publishedAt: string | null;
  readonly upToDate: boolean;
  readonly releaseUrl: string;
  readonly portable: AppUpdateAsset | null;
  readonly setup: AppUpdateAsset | null;
}

export type GitHubErrorCode = 'E_NETWORK' | 'E_API' | 'E_NO_ASSET' | 'E_TOO_LARGE';
export class GitHubError extends Error {
  readonly code: GitHubErrorCode;

  constructor(code: GitHubErrorCode, message: string) {
    super(message);
    this.name = 'GitHubError';
    this.code = code;
  }
}

export interface GitHubService {
  resolve(input: string): Promise<ResolvedRelease>;
  download(input: string, opts?: { onProgress?: (received: number, total: number | undefined) => void }): Promise<DownloadedDatabase>;
  checkUpdate(
    input: string,
    currentVersion: string | null,
    opts?: { localUpdatedAt?: string | null },
  ): Promise<UpdateCheck>;
  /** 检查程序本体更新（读 releases 列表里的安装包资产名）。 */
  checkAppUpdate(input: string, currentVersion: string | null): Promise<AppUpdateCheck>;
}

export interface GitHubServiceOptions {
  /** GitHub API 基址（企业版/GHES 可覆盖） */
  readonly apiBase?: string;
  /** 数据库资产上限，默认 256 MB；超过直接拒绝，避免把内存打满 */
  readonly maxBytes?: number;
}

const DEFAULT_API_BASE = 'https://api.github.com';
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

interface RawAsset {
  name?: unknown;
  browser_download_url?: unknown;
  url?: unknown;
  size?: unknown;
}

interface RawRelease {
  tag_name?: unknown;
  published_at?: unknown;
  html_url?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: unknown;
}

interface RawReleaseListEntry extends RawRelease {
  name?: unknown;
}

const APP_ASSET_RE = /^(.+)-(portable|x64-setup)\.exe$/i;

/** 从 `TouhouPeachReader-0.1.10-x64-setup.exe` 里解析版本与渠道。 */
export function parseAppAsset(
  name: string,
): { version: string; kind: 'portable' | 'setup' } | null {
  const prefix = `${REPOSITORY_APP}-`;
  if (!name.startsWith(prefix)) return null;
  const match = APP_ASSET_RE.exec(name.slice(prefix.length));
  if (match === null) return null;
  const version = match[1]?.trim() ?? '';
  if (version.length === 0) return null;
  return { version, kind: match[2]?.toLowerCase() === 'portable' ? 'portable' : 'setup' };
}

function normalizeVersion(tag: string): string {
  return tag.trim().replace(/^v/i, '');
}

function readAssets(raw: unknown): GitHubAsset[] {
  if (!Array.isArray(raw)) return [];
  const assets: GitHubAsset[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue;
    const asset = item as RawAsset;
    const name = typeof asset.name === 'string' ? asset.name : '';
    const url =
      typeof asset.browser_download_url === 'string'
        ? asset.browser_download_url
        : typeof asset.url === 'string'
          ? asset.url
          : '';
    if (name.length === 0 || url.length === 0) continue;
    assets.push({ name, url, size: typeof asset.size === 'number' ? asset.size : 0 });
  }
  return assets;
}

export function pickDatabaseAsset(assets: readonly GitHubAsset[]): GitHubAsset | null {
  const tpr = assets.find((a) => a.name.toLowerCase().endsWith('.tpr'));
  if (tpr !== undefined) return tpr;
  const zip = assets.find((a) => a.name.toLowerCase().endsWith('.zip'));
  return zip ?? null;
}

export function createGitHubService(
  platform: Platform,
  options: GitHubServiceOptions = {},
): GitHubService {
  const apiBase = (options.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, '');
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  async function apiGet<T>(url: string): Promise<T> {
    try {
      return await platform.network.fetchJson<T>(url, {
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
      });
    } catch (cause) {
      throw new GitHubError(
        'E_API',
        `GitHub API 请求失败：${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  async function resolveRef(ref: GitHubRef): Promise<ResolvedRelease> {
    if (ref.asset !== undefined) {
      const asset: GitHubAsset = { name: ref.asset.name, url: ref.asset.url, size: 0 };
      return {
        owner: ref.owner,
        repo: ref.repo,
        tag: ref.tag ?? 'asset',
        publishedAt: null,
        assets: [asset],
        database: asset,
      };
    }
    const path =
      ref.tag === undefined
        ? `/repos/${ref.owner}/${ref.repo}/releases/latest`
        : `/repos/${ref.owner}/${ref.repo}/releases/tags/${encodeURIComponent(ref.tag)}`;
    const body = await apiGet<unknown>(`${apiBase}${path}`);
    if (body === null || typeof body !== 'object') {
      throw new GitHubError('E_API', 'GitHub 返回了无法识别的 release 数据');
    }
    const raw = body as RawRelease;
    const tag = typeof raw.tag_name === 'string' ? raw.tag_name : (ref.tag ?? '');
    if (tag.length === 0) {
      throw new GitHubError('E_API', '该 release 没有 tag，无法判断版本');
    }
    const publishedAt = typeof raw.published_at === 'string' ? raw.published_at : null;
    const assets = readAssets(raw.assets);
    return {
      owner: ref.owner,
      repo: ref.repo,
      tag,
      publishedAt,
      assets,
      database: pickDatabaseAsset(assets),
    };
  }

  async function resolve(input: string): Promise<ResolvedRelease> {
    return resolveRef(parseGitHubInput(input));
  }

  async function download(
    input: string,
    opts: { onProgress?: (received: number, total: number | undefined) => void } = {},
  ): Promise<DownloadedDatabase> {
    const release = await resolve(input);
    if (release.database === null) {
      const names = release.assets.map((a) => a.name).join('、') || '（没有资产）';
      throw new GitHubError('E_NO_ASSET', `该 release 里没有 .tpr 或 .zip 资产：${names}`);
    }
    const asset = release.database;
    if (asset.size > maxBytes) {
      throw new GitHubError(
        'E_TOO_LARGE',
        `数据库包 ${(asset.size / 1024 / 1024).toFixed(1)} MB 超过上限 ${(maxBytes / 1024 / 1024).toFixed(0)} MB`,
      );
    }
    const url = asset.url;
    let bytes: Uint8Array;
    try {
      bytes = await platform.network.download(url, opts.onProgress);
    } catch (cause) {
      throw new GitHubError(
        'E_NETWORK',
        `下载失败：${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    if (bytes.byteLength > maxBytes) {
      throw new GitHubError('E_TOO_LARGE', `下载到的包超过 ${(maxBytes / 1024 / 1024).toFixed(0)} MB 上限`);
    }
    return { bytes, fileName: asset.name, tag: release.tag, release };
  }

  async function checkUpdate(
    input: string,
    currentVersion: string | null,
    opts: { localUpdatedAt?: string | null } = {},
  ): Promise<UpdateCheck> {
    const release = await resolve(input);
    const latest = normalizeVersion(release.tag);
    const current = currentVersion;
    return {
      owner: release.owner,
      repo: release.repo,
      current,
      tag: release.tag,
      latest,
      publishedAt: release.publishedAt,
      upToDate:
        current !== null &&
        !isNewerDatabaseVersion(current, {
          version: latest,
          publishedAt: release.publishedAt,
          localUpdatedAt: opts.localUpdatedAt ?? null,
        }),
      assetName: release.database?.name ?? null,
      assetUrl: release.database?.url ?? null,
    };
  }

  async function checkAppUpdate(
    input: string,
    currentVersion: string | null,
  ): Promise<AppUpdateCheck> {
    const ref = parseGitHubInput(input);
    const body = await apiGet<unknown>(
      `${apiBase}/repos/${ref.owner}/${ref.repo}/releases?per_page=30`,
    );
    if (!Array.isArray(body)) {
      throw new GitHubError('E_API', 'GitHub 返回了无法识别的 release 列表');
    }

    interface Candidate {
      version: string;
      publishedAt: string | null;
      releaseUrl: string;
      portable: AppUpdateAsset | null;
      setup: AppUpdateAsset | null;
    }

    const byVersion = new Map<string, Candidate>();
    for (const item of body) {
      if (item === null || typeof item !== 'object') continue;
      const raw = item as RawReleaseListEntry;
      if (raw.draft === true || raw.prerelease === true) continue;
      const publishedAt = typeof raw.published_at === 'string' ? raw.published_at : null;
      const releaseUrl =
        typeof raw.html_url === 'string'
          ? raw.html_url
          : `https://github.com/${ref.owner}/${ref.repo}/releases`;
      for (const asset of readAssets(raw.assets)) {
        const parsed = parseAppAsset(asset.name);
        if (parsed === null) continue;
        const existing = byVersion.get(parsed.version);
        const candidate: Candidate = existing ?? {
          version: parsed.version,
          publishedAt,
          releaseUrl,
          portable: null,
          setup: null,
        };
        if (parsed.kind === 'portable') {
          candidate.portable = { kind: 'portable', name: asset.name, url: asset.url };
        } else {
          candidate.setup = { kind: 'setup', name: asset.name, url: asset.url };
        }
        byVersion.set(parsed.version, candidate);
      }
    }

    let best: Candidate | null = null;
    for (const candidate of byVersion.values()) {
      if (best === null || isNewerAppVersion(best.version, candidate.version)) {
        best = candidate;
      }
    }
    if (best === null) {
      throw new GitHubError('E_NO_ASSET', '发布页里没有找到程序安装包资产');
    }

    const current = currentVersion === null || currentVersion.trim().length === 0
      ? null
      : currentVersion.trim();
    return {
      owner: ref.owner,
      repo: ref.repo,
      current,
      latest: best.version,
      publishedAt: best.publishedAt,
      upToDate: current !== null && !isNewerAppVersion(current, best.version),
      releaseUrl: best.releaseUrl,
      portable: best.portable,
      setup: best.setup,
    };
  }

  return { resolve, download, checkUpdate, checkAppUpdate };
}
