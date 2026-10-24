#!/usr/bin/env node
/**
 * 发布到 GitHub Releases（一条命令补发当前版本）。
 *
 * 背景：Release 的标签跟随**数据库版本**（v1.0.0 = 数据库 1.0.0），应用版本只体现在
 * 资产文件名与标题里。所以同一份数据库上重发程序，正确做法是**更新已有 release**，
 * 而不是开新标签——新标签会让内置默认数据库源（/releases/latest）指向没有 .tpr 的版本。
 *
 * 凭据：优先读 GH_TOKEN / GITHUB_TOKEN；没设就直接借用 git 已经配好的凭据
 * （Git Credential Manager / store 都行），所以只要 `git push` 能推就能发 release。
 *
 * 用法：
 *   node scripts/publish-release.mjs                      # 更新带 .tpr 的那个 release
 *   node scripts/publish-release.mjs --tag v1.0.0          # 指定标签
 *   node scripts/publish-release.mjs --notes 发布说明.md    # 覆盖 release 说明（Markdown）
 *   node scripts/publish-release.mjs --clean               # 顺手删掉旧版本的安装包/免安装 exe
 *   node scripts/publish-release.mjs --dry-run             # 只打印要做什么
 *
 * 资产来自 dist/release（缺失时自动从 dist/portable 复制），数据库资产保持原样不动。
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const RELEASE_DIR = join(DIST, 'release');
const PORTABLE_DIR = join(DIST, 'portable');
const TAURI_CONF = join(ROOT, 'apps/desktop/src-tauri/tauri.conf.json');
const API = 'https://api.github.com';
const REPO = process.env.TPR_REPO ?? 'X1a0se/Touhou-Peach-Reader';
const APP = 'TouhouPeachReader';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes('--' + name);
const value = (name) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const envToken = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
const dryRun = flag('dry-run');
const tag = value('tag');
const notesPath = value('notes');
const clean = flag('clean');

const fail = (message) => {
  console.error('\n✖ ' + message);
  process.exit(1);
};

/** 没有 GH_TOKEN 时，借 git 自己的凭据（GCM / manager / store 都行）。 */
function storedCredential() {
  try {
    const out = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const fields = Object.fromEntries(
      out
        .trim()
        .split(/\r?\n/)
        .map((line) => {
          const i = line.indexOf('=');
          return [line.slice(0, i), line.slice(i + 1)];
        }),
    );
    if (!fields.password) return null;
    return { username: fields.username || 'x-access-token', password: fields.password, source: 'git credential' };
  } catch {
    return null;
  }
}

const credential = envToken
  ? { username: 'x-access-token', password: envToken, source: 'GH_TOKEN' }
  : storedCredential();
const auth = credential
  ? 'Basic ' + Buffer.from(credential.username + ':' + credential.password).toString('base64')
  : null;

const version = JSON.parse(readFileSync(TAURI_CONF, 'utf8')).version;

const HEADERS = {
  authorization: auth,
  accept: 'application/vnd.github+json',
  'user-agent': 'touhou-peach-reader',
};

/** path 以 /repos/<owner>/<repo> 开头；这里只做重试与 JSON 解析。 */
async function api(method, path, body) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(API + path, {
        method,
        headers: body ? { ...HEADERS, 'content-type': 'application/json' } : HEADERS,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, json: text ? JSON.parse(text) : null };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  fail(method + ' ' + path + ' 失败：' + lastError.message);
}

async function upload(releaseId, file) {
  const data = readFileSync(file.path);
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(
        'https://uploads.github.com/repos/' + REPO + '/releases/' + releaseId + '/assets?name=' + encodeURIComponent(file.name),
        {
          method: 'POST',
          headers: {
            ...HEADERS,
            'content-type': 'application/octet-stream',
            'content-length': String(data.byteLength),
          },
          body: data,
        },
      );
      const text = await res.text();
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + text.slice(0, 200));
      const json = JSON.parse(text);
      console.log('  ↑ ' + file.name + '  ' + json.size + ' 字节');
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 4000));
    }
  }
  fail('上传 ' + file.name + ' 失败：' + lastError.message);
}

/** 把 dist/portable 里的产物按 release 命名规则复制到 dist/release，并列出候选资产。 */
function collectAssets() {
  const installer = readdirSync(PORTABLE_DIR).find((name) => name.endsWith('_x64-setup.exe'));
  const wanted = [{ name: APP + '-' + version + '-portable.exe', from: join(PORTABLE_DIR, 'Touhou Peach Reader.exe') }];
  if (installer) wanted.push({ name: APP + '-' + version + '-x64-setup.exe', from: join(PORTABLE_DIR, installer) });

  for (const item of wanted) {
    const target = join(RELEASE_DIR, item.name);
    if (existsSync(target)) continue;
    if (!existsSync(item.from)) fail('找不到构建产物：' + item.from + '（先跑 corepack pnpm release）');
    copyFileSync(item.from, target);
    console.log('  + ' + item.name + '（复制自 dist/portable）');
  }

  return readdirSync(RELEASE_DIR)
    .filter((name) => name.startsWith(APP + '-'))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, path: join(RELEASE_DIR, name), size: statSync(join(RELEASE_DIR, name)).size }));
}

const main = async () => {
  if (!auth) fail('缺少凭据：设置 GH_TOKEN，或先让 git 能访问 GitHub（凭据管理器里有账号即可）');
  console.log('仓库 ' + REPO + ' · 应用版本 ' + version + ' · 凭据 ' + credential.source);

  const files = collectAssets();
  if (files.length === 0) fail('dist/release 里没有可发布的资产');

  const listed = await api('GET', '/repos/' + REPO + '/releases?per_page=30');
  if (!listed.ok) fail('读取 release 列表失败：HTTP ' + listed.status + ' ' + (listed.json?.message ?? ''));
  const releases = listed.json;

  const release = tag
    ? releases.find((r) => r.tag_name === tag)
    : releases.find((r) => r.assets.some((a) => a.name.endsWith('.tpr')));
  if (!release) fail('找不到 release（标签 ' + (tag ?? '自动') + '），请用 --tag 指定');

  const dbAsset = release.assets.find((a) => a.name.endsWith('.tpr'));
  const dbVersion = dbAsset ? (/DB-(\d+\.\d+\.\d+)\.tpr$/.exec(dbAsset.name)?.[1] ?? '未知') : '未知';
  const title = 'Touhou Peach Reader ' + version + ' · 数据库 ' + dbVersion;
  const body = notesPath ? readFileSync(notesPath, 'utf8') : release.body;

  // 只传当前版本的安装包/免安装 exe 与数据库资产；旧版本文件留给 --clean 处理
  const wanted = files.filter((file) => file.name.includes('-' + version + '-') || file.name.endsWith('.tpr'));
  const remote = (name) => release.assets.find((a) => a.name === name);

  console.log('标签 ' + release.tag_name + ' · 标题「' + title + '」');
  if (dryRun) {
    console.log('（dry-run）将上传：');
    for (const file of wanted) {
      const existing = remote(file.name);
      const skip = existing && existing.size === file.size;
      console.log('  · ' + file.name + '  ' + file.size + ' 字节' + (skip ? '（已存在且大小一致，跳过）' : ''));
    }
    if (clean) console.log('（dry-run）将删除旧版本资产（保留 .tpr）');
    return;
  }

  const releasePath = '/repos/' + REPO + '/releases/' + release.id;
  const patched = await api('PATCH', releasePath, { name: title, body, draft: false });
  if (!patched.ok) fail('更新 release 失败：HTTP ' + patched.status + ' ' + (patched.json?.message ?? ''));
  console.log('  ✓ 已更新 release 标题与说明');

  let fresh = release.assets;
  for (const file of wanted) {
    const existing = fresh.find((a) => a.name === file.name);
    if (existing && existing.size === file.size) {
      console.log('  = ' + file.name + ' 已是最新，跳过');
      continue;
    }
    if (existing) {
      const removed = await api('DELETE', '/repos/' + REPO + '/releases/assets/' + existing.id);
      if (!removed.ok) fail('删除旧资产 ' + file.name + ' 失败：HTTP ' + removed.status);
    }
    await upload(release.id, file);
  }

  if (clean) {
    fresh = (await api('GET', releasePath + '/assets')).json ?? fresh;
    const current = new Set(wanted.map((f) => f.name));
    const stale = fresh.filter((a) => a.name.startsWith(APP + '-') && !a.name.endsWith('.tpr') && !current.has(a.name));
    for (const asset of stale) {
      const removed = await api('DELETE', '/repos/' + REPO + '/releases/assets/' + asset.id);
      console.log((removed.ok ? '  − 已删除旧资产 ' : '  ! 删除失败 ') + asset.name);
    }
  }

  console.log('\n✓ ' + REPO + ' ' + release.tag_name + ' → ' + title);
  console.log('  https://github.com/' + REPO + '/releases/tag/' + release.tag_name);
};

main().catch((error) => fail(error.message));
