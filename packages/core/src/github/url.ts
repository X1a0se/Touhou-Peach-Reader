/**
 * GitHub 输入解析（design §11.7 / Goal 11）。
 *
 * 支持四种输入：
 * 1. 仓库地址：`https://github.com/owner/repo`            → 取 latest release
 * 2. release 页：`https://github.com/owner/repo/releases` / `/releases/latest` / `/releases/tag/v1.2.3`
 * 3. 资产直链：`https://github.com/owner/repo/releases/download/v1.2.3/db.tpr`
 * 4. 速记：`owner/repo`（不允许带空格与协议）
 */

export interface GitHubAssetRef {
  readonly url: string;
  readonly name: string;
}

export interface GitHubRef {
  readonly owner: string;
  readonly repo: string;
  /** 指定 tag；缺省表示 latest */
  readonly tag?: string;
  /** 资产直链（给了就不必调 API） */
  readonly asset?: GitHubAssetRef;
  /** 原始输入，用于报错与「默认源」回显 */
  readonly raw: string;
}

export type GitHubUrlErrorCode = 'E_GITHUB_URL' | 'E_GITHUB_HOST';

export class GitHubUrlError extends Error {
  readonly code: GitHubUrlErrorCode;

  constructor(code: GitHubUrlErrorCode, message: string) {
    super(message);
    this.name = 'GitHubUrlError';
    this.code = code;
  }
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const REPO_RE = /^[A-Za-z0-9._-]+$/;
const SHORTHAND_RE = /^([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+)$/;

function assertNames(owner: string, repo: string): void {
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo)) {
    throw new GitHubUrlError('E_GITHUB_URL', `GitHub 地址不合法：${owner}/${repo}`);
  }
}

function stripUrlNoise(input: string): string {
  return input.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
}

export function parseGitHubInput(input: string): GitHubRef {
  const raw = input.trim();
  if (raw.length === 0) {
    throw new GitHubUrlError('E_GITHUB_URL', '请输入 GitHub 仓库或 release 地址');
  }

  // 资产直链
  const assetMatch = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/(.+)$/.exec(
    stripUrlNoise(raw),
  );
  if (assetMatch) {
    const [, owner, repo, tag, name] = assetMatch;
    if (owner === undefined || repo === undefined || tag === undefined || name === undefined) {
      throw new GitHubUrlError('E_GITHUB_URL', `GitHub 地址不合法：${raw}`);
    }
    assertNames(owner, repo);
    if (name.length === 0) {
      throw new GitHubUrlError('E_GITHUB_URL', '资产直链缺少文件名');
    }
    return {
      owner,
      repo,
      tag,
      asset: { url: `https://github.com/${owner}/${repo}/releases/download/${tag}/${name}`, name },
      raw,
    };
  }

  // 速记 owner/repo
  const shorthand = SHORTHAND_RE.exec(raw);
  if (shorthand && !raw.includes('://')) {
    const [, owner, repo] = shorthand;
    if (owner === undefined || repo === undefined) {
      throw new GitHubUrlError('E_GITHUB_URL', `GitHub 地址不合法：${raw}`);
    }
    assertNames(owner, repo);
    return { owner, repo, raw };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new GitHubUrlError('E_GITHUB_URL', `无法识别的 GitHub 地址：${raw}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new GitHubUrlError('E_GITHUB_URL', `只支持 http(s) 地址：${raw}`);
  }
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    throw new GitHubUrlError('E_GITHUB_HOST', `只支持 github.com 的地址，收到：${url.hostname}`);
  }

  const parts = url.pathname.split('/').filter((p) => p.length > 0);
  const [owner, repo, section, sub, ...rest] = parts;
  if (owner === undefined || repo === undefined) {
    throw new GitHubUrlError('E_GITHUB_URL', `地址里没有 owner/repo：${raw}`);
  }
  assertNames(owner, repo);

  if (section === undefined) {
    return { owner, repo, raw };
  }
  if (section !== 'releases') {
    throw new GitHubUrlError('E_GITHUB_URL', `只支持仓库首页与 release 地址，收到 /${section}`);
  }
  if (sub === undefined || sub === 'latest') {
    return { owner, repo, raw };
  }
  if (sub === 'tag') {
    const tag = rest.join('/');
    if (tag.length === 0) {
      throw new GitHubUrlError('E_GITHUB_URL', 'release/tag 地址缺少 tag');
    }
    return { owner, repo, tag, raw };
  }
  throw new GitHubUrlError('E_GITHUB_URL', `无法识别的 release 子路径：/${section}/${sub}`);
}

/** 默认源（可能是 owner/repo，也可能是 URL）的展示用短名 */
export function describeGitHubRef(ref: GitHubRef): string {
  return `${ref.owner}/${ref.repo}${ref.tag ? `@${ref.tag}` : ''}`;
}
