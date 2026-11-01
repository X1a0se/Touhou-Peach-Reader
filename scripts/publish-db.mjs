#!/usr/bin/env node
/**
 * 把自选的 .tpr 数据库发布到 GitHub Release（双击 发布数据库.cmd，或 node scripts/publish-db.mjs）。
 *
 * 背景：Release 标签跟随数据库版本（v<数据库名>-<年-月-日-时分秒> = 数据库版本），应用内置源指向
 * /releases/latest，并用标签去掉 v 后与包内 manifest.version 比较来判断更新。所以本脚本：
 * - 默认每次上传都把包内 manifest.version 改写成「数据库名-年-月-日-时分秒」，新建同名标签的 Release，
 *   并把上一版的安装包/免安装 exe 一起复制过去，保证 /releases/latest 仍是三件套；
 * - 用 --tag 指定且该标签已存在时，原地替换这个 Release 里的 .tpr（应用只取第一个 .tpr，一个 Release 只能留一份）。
 *
 * 凭据：优先 GH_TOKEN / GITHUB_TOKEN；没设就借用 git 已配好的凭据（和 publish-release.mjs 一致），
 * 所以只要 git push 能推，就能发 Release。
 *
 * 用法：node scripts/publish-db.mjs --help
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_DIR = join(ROOT, 'dist', 'release');
const TAURI_CONF = join(ROOT, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json');
const README_FILE = join(ROOT, 'README.md');
const API = 'https://api.github.com';
const APP = 'TouhouPeachReader';
const GITHUB_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const APP_MAX_BYTES = 256 * 1024 * 1024;
const DB_ASSET_RE = /\.tpr$/i;
const MAX_VERSION_LENGTH = 64;
/** 版本名的时间戳后缀固定 18 个字符，前缀最多 46 个字符 */
const MAX_VERSION_PREFIX = 46;
const VALUE_FLAGS = new Set(['tag', 'from-tag', 'notes', 'repo']);

let REPO = process.env.TPR_REPO ?? 'X1a0se/Touhou-Peach-Reader';
let AUTH = null;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function sizeText(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

function describeAsset(asset) {
  return asset.name + '（' + sizeText(asset.size) + '）';
}

function apiMessage(result) {
  if (result.json !== null && typeof result.json === 'object' && typeof result.json.message === 'string') {
    return result.json.message;
  }
  return '';
}

function fail(message) {
  console.error('\n✖ ' + message);
  process.exit(1);
}

function printUsage(stream) {
  stream.write(
    [
      '用法：node scripts/publish-db.mjs [<路径.tpr>] [选项]',
      '',
      '  <路径.tpr>           要上传的数据库包；省略时弹出文件选择框（Windows）。也可把文件拖到 发布数据库.cmd 上。',
      '  --tag <标签>         手动指定标签（不自动生成时间戳）；默认 v<数据库名-年-月-日-时分秒>',
      '  --from-tag <标签>    新建 Release 时从哪个 Release 复制安装包/免安装 exe，默认自动挑最新的',
      '  --notes <文件>       新建 Release 的说明（Markdown）；默认沿用源 Release 的说明并追加数据库摘要',
      '  --force              同名同大小也重新上传（并清掉 Release 里多余的 .tpr）',
      '  --tag 已存在时原地替换该 Release 的 .tpr；默认每次上传都会生成新版本和新 Release。',
      '  --yes                跳过交互确认；非交互环境必须显式给出',
      '  --dry-run            只打印计划，不发任何写请求',
      '  --repo <owner/repo>  覆盖仓库（默认 X1a0se/Touhou-Peach-Reader，可用环境变量 TPR_REPO）',
      '  --help               显示这段帮助',
      '',
      '示例：',
      '  node scripts/publish-db.mjs "D:/下载/我的数据库.tpr" --dry-run',
      '  node scripts/publish-db.mjs "D:/下载/我的数据库.tpr" --yes',
      '  node scripts/publish-db.mjs "D:/下载/我的数据库.tpr" --tag v1.0.1 --yes',
      '',
    ].join('\n'),
  );
}

function usageError(message) {
  console.error('\n✖ ' + message + '\n');
  printUsage(process.stderr);
  process.exit(2);
}

function isValidTag(tag) {
  if (tag.length === 0) return false;
  const result = spawnSync('git', ['check-ref-format', 'refs/tags/' + tag], { stdio: 'ignore' });
  return result.status === 0;
}

function formatLocalTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return (
    date.getFullYear() +
    '-' +
    pad(date.getMonth() + 1) +
    '-' +
    pad(date.getDate()) +
    '-' +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

/** 把数据库名清洗成可放进 git 标签的前缀；时间戳单独拼接，保证总长不超过 64。 */
function sanitizeVersionPrefix(name) {
  const cleaned = String(name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|~^]/g, '-')
    .replace(/[\[\]]/g, '-')
    .replace(/\.\.+/g, '.')
    .replace(/\s+/g, '-')
    .replace(/@\{/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, MAX_VERSION_PREFIX)
    .replace(/[.-]+$/g, '');
  return cleaned.length > 0 ? cleaned : '数据库';
}

function timestampedVersion(name, timestamp) {
  return sanitizeVersionPrefix(name) + '-' + timestamp;
}

function isAsciiVersion(version) {
  return /^[0-9A-Za-z._-]+$/.test(version);
}

function assetNameFor(version, timestamp) {
  // GitHub 资产名保持 ASCII；中文版本用时间戳兜底，避免下载头/浏览器兼容问题。
  const safe = isAsciiVersion(version) ? version : timestamp;
  return APP + '-DB-' + safe + '.tpr';
}

function parseArgs(argv) {
  const opts = { tag: null, fromTag: null, notes: null, repo: null, force: false, yes: false, dryRun: false, help: false };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { opts.help = true; continue; }
    if (arg === '--force') { opts.force = true; continue; }
    if (arg === '--yes' || arg === '-y') { opts.yes = true; continue; }
    if (arg === '--dry-run') { opts.dryRun = true; continue; }
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      if (!VALUE_FLAGS.has(name)) usageError('未知参数：' + arg);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) usageError('--' + name + ' 需要一个值');
      i += 1;
      if (name === 'tag') opts.tag = value;
      else if (name === 'from-tag') opts.fromTag = value;
      else if (name === 'notes') opts.notes = value;
      else opts.repo = value;
      continue;
    }
    if (arg.startsWith('-')) usageError('未知参数：' + arg);
    positional.push(arg);
  }
  if (opts.tag !== null && !isValidTag(opts.tag)) usageError('--tag 不是合法的标签名：' + opts.tag);
  if (opts.repo !== null && !/^[^/\s]+\/[^/\s]+$/.test(opts.repo)) usageError('--repo 需要 owner/repo 形式：' + opts.repo);
  return { opts, positional };
}

/** 没有 GH_TOKEN 时，借 git 自己的凭据（GCM / manager / store 都行）。 */
function storedCredential() {
  try {
    const out = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 8000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
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

function headers(extra) {
  const result = Object.assign({ accept: 'application/vnd.github+json', 'user-agent': 'touhou-peach-reader' }, extra);
  if (AUTH !== null) result.authorization = AUTH;
  return result;
}

/** path 以 /repos/<owner>/<repo> 开头；网络错误与 5xx / 429 会重试。 */
async function api(method, path, body) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(API + path, {
        method,
        headers: body === undefined ? headers() : headers({ 'content-type': 'application/json' }),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      const text = await response.text();
      let json = null;
      if (text.length > 0) {
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
      }
      if (!response.ok && (response.status === 429 || response.status >= 500) && attempt < 3) {
        await sleep(4000);
        continue;
      }
      return { ok: response.ok, status: response.status, json };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(3000);
    }
  }
  fail(method + ' ' + path + ' 失败：' + (lastError === null ? '未知错误' : lastError.message));
}

async function upload(releaseId, file) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(
        'https://uploads.github.com/repos/' + REPO + '/releases/' + releaseId + '/assets?name=' + encodeURIComponent(file.name),
        {
          method: 'POST',
          headers: headers({ 'content-type': 'application/octet-stream', 'content-length': String(file.data.byteLength) }),
          body: file.data,
          signal: AbortSignal.timeout(300000),
        },
      );
      const text = await response.text();
      if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + text.slice(0, 200));
      const json = JSON.parse(text);
      console.log('  ↑ ' + file.name + '  ' + json.size + ' 字节');
      return json;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(4000);
    }
  }
  fail('上传 ' + file.name + ' 失败：' + (lastError === null ? '未知错误' : lastError.message));
}

async function downloadAsset(asset) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(API + '/repos/' + REPO + '/releases/assets/' + asset.id, {
        headers: headers({ accept: 'application/octet-stream' }),
        redirect: 'follow',
        signal: AbortSignal.timeout(300000),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error('HTTP ' + response.status + ' ' + text.slice(0, 200));
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(3000);
    }
  }
  fail('下载 ' + asset.name + ' 失败：' + (lastError === null ? '未知错误' : lastError.message));
}

/** 在 Windows 上弹系统文件选择框；取消返回空字符串。 */
function pickDatabaseFile() {
  if (process.platform !== 'win32') usageError('请直接在命令行给出 .tpr 路径（非 Windows 不弹选择框）');
  const script = [
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Windows.Forms',
    '$d = New-Object System.Windows.Forms.OpenFileDialog',
    '$d.Title = "选择要上传到 GitHub Release 的 .tpr 数据库"',
    '$d.Filter = "桃图数据库 (*.tpr)|*.tpr|所有文件 (*.*)|*.*"',
    '$d.CheckFileExists = $true',
    'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.FileName) }',
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) fail('无法启动文件选择框：' + result.error.message);
  const picked = (result.stdout ?? '').trim();
  if (picked.length > 0) return picked;
  if (result.status !== 0) fail('文件选择框启动失败：' + (result.stderr ?? '').trim().slice(0, 300));
  console.log('已取消，未上传。');
  process.exit(0);
}

function findEocd(buf) {
  if (buf.length < 22) return -1;
  const minimum = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minimum; i -= 1) {
    if (buf.readUInt32LE(i) !== 0x06054b50) continue;
    const commentLength = buf.readUInt16LE(i + 20);
    if (i + 22 + commentLength === buf.length) return i;
  }
  return -1;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function hasZip64Extra(extra) {
  let offset = 0;
  while (offset + 4 <= extra.length) {
    const id = extra.readUInt16LE(offset);
    const length = extra.readUInt16LE(offset + 2);
    if (id === 0x0001) return true;
    offset += 4 + length;
  }
  return false;
}

function extractEntry(buf, entry, label, limit) {
  const local = entry.localOffset;
  if (local < 0 || local + 30 > limit || buf.readUInt32LE(local) !== 0x04034b50) {
    throw new Error('ZIP 条目的本地头损坏（' + entry.name + '）：' + label);
  }
  const flags = buf.readUInt16LE(local + 6);
  const method = buf.readUInt16LE(local + 8);
  const nameLength = buf.readUInt16LE(local + 26);
  const extraLength = buf.readUInt16LE(local + 28);
  if ((flags & 1) !== 0) throw new Error('不支持加密的 ZIP 条目：' + entry.name + '（' + label + '）');
  if (method !== entry.method) {
    throw new Error('ZIP 条目本地头与中央目录的压缩方式不一致：' + entry.name + '（' + label + '）');
  }
  const localName = buf.subarray(local + 30, local + 30 + nameLength);
  if (!localName.equals(entry.nameBytes)) {
    throw new Error('ZIP 条目本地头与中央目录的文件名不一致：' + entry.name + '（' + label + '）');
  }
  const start = local + 30 + nameLength + extraLength;
  if (start + entry.compressedSize > limit) {
    throw new Error('ZIP 条目数据越界：' + entry.name + '（' + label + '）');
  }
  const raw = buf.subarray(start, start + entry.compressedSize);
  let data;
  try {
    data = entry.method === 0 ? raw : inflateRawSync(raw);
  } catch (error) {
    throw new Error('解压 ZIP 条目失败（' + entry.name + '）：' + error.message);
  }
  if (data.length !== entry.uncompressedSize) {
    throw new Error('ZIP 条目解压后大小不符：' + entry.name + '（' + label + '）');
  }
  if (crc32(data) !== entry.crc) {
    throw new Error('ZIP 条目 CRC 校验失败：' + entry.name + '（' + label + '）');
  }
  return data;
}

/**
 * 读取标准 ZIP 的 EOCD、中央目录与全部本地条目。
 * 只支持单盘、非 ZIP64、非加密、method 0/8 的包；.tpr 目前都是这种形态。
 */
function readArchive(buf, label) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('不是有效的 ZIP（找不到 EOCD）：' + label);
  const diskNumber = buf.readUInt16LE(eocd + 4);
  const cdDisk = buf.readUInt16LE(eocd + 6);
  const countDisk = buf.readUInt16LE(eocd + 8);
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const commentLength = buf.readUInt16LE(eocd + 20);
  const comment = buf.subarray(eocd + 22, eocd + 22 + commentLength);
  if (diskNumber !== 0 || cdDisk !== 0 || countDisk !== count) {
    throw new Error('不支持分卷 ZIP：' + label);
  }
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new Error('暂不支持 ZIP64 数据库包：' + label);
  }
  if (cdOffset + cdSize !== eocd) {
    throw new Error('ZIP 中央目录位置不连续（可能带数字签名或尾随数据）：' + label);
  }
  if (count === 0) throw new Error('ZIP 里没有文件：' + label);

  const entries = [];
  let offset = cdOffset;
  let rootManifest = null;
  let nestedManifest = null;
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > cdOffset + cdSize || buf.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('ZIP 中央目录损坏：' + label);
    }
    const versionMadeBy = buf.readUInt16LE(offset + 4);
    const versionNeeded = buf.readUInt16LE(offset + 6);
    const flags = buf.readUInt16LE(offset + 8);
    const method = buf.readUInt16LE(offset + 10);
    const time = buf.readUInt16LE(offset + 12);
    const date = buf.readUInt16LE(offset + 14);
    const crc = buf.readUInt32LE(offset + 16);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const entryCommentLength = buf.readUInt16LE(offset + 32);
    const diskStart = buf.readUInt16LE(offset + 34);
    const internalAttrs = buf.readUInt16LE(offset + 36);
    const externalAttrs = buf.readUInt32LE(offset + 38);
    const localOffset = buf.readUInt32LE(offset + 42);
    const nameBytes = buf.subarray(offset + 46, offset + 46 + nameLength);
    const name = nameBytes.toString('utf8');
    const extra = buf.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength);
    const entryComment = buf.subarray(
      offset + 46 + nameLength + extraLength,
      offset + 46 + nameLength + extraLength + entryCommentLength,
    );
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('暂不支持 ZIP64 数据库包：' + label);
    }
    if (hasZip64Extra(extra)) throw new Error('暂不支持 ZIP64 数据库包：' + label);
    if ((flags & 1) !== 0) throw new Error('不支持加密的 ZIP 条目：' + name + '（' + label + '）');
    if (method !== 0 && method !== 8) {
      throw new Error('不支持的 ZIP 压缩方式 ' + method + '：' + name + '（' + label + '）');
    }
    if (diskStart !== 0) throw new Error('不支持分卷 ZIP：' + label);
    if (localOffset >= cdOffset) {
      throw new Error('ZIP 条目本地头位置不在中央目录之前：' + name + '（' + label + '）');
    }
    const entry = {
      name,
      nameBytes,
      versionMadeBy,
      versionNeeded,
      flags,
      method,
      time,
      date,
      crc,
      compressedSize,
      uncompressedSize,
      extra,
      comment: entryComment,
      internalAttrs,
      externalAttrs,
      localOffset,
    };
    entries.push(entry);
    if (name === 'manifest.json') rootManifest = entry;
    else if (nestedManifest === null && name.endsWith('/manifest.json')) nestedManifest = entry;
    offset += 46 + nameLength + extraLength + entryCommentLength;
  }
  if (offset !== cdOffset + cdSize) throw new Error('ZIP 中央目录长度不符：' + label);

  const manifestEntry = rootManifest ?? nestedManifest;
  if (manifestEntry === null) {
    throw new Error('包里没有 manifest.json（不是桃图数据库包？）：' + label);
  }

  let manifestBytes = null;
  for (const entry of entries) {
    const data = extractEntry(buf, entry, label, cdOffset);
    if (entry === manifestEntry) manifestBytes = data;
  }
  if (manifestBytes === null) throw new Error('读不到 manifest.json：' + label);
  return {
    entries,
    manifestEntry,
    manifestBytes,
    comment,
    cdOffset,
    cdSize,
  };
}

function manifestFromArchive(archive, label) {
  let manifest;
  try {
    manifest = JSON.parse(archive.manifestBytes.toString('utf8'));
  } catch (error) {
    throw new Error('manifest.json 不是合法 JSON：' + error.message + '（' + label + '）');
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('manifest.json 结构不对：需要一个对象（' + label + '）');
  }
  return manifest;
}

/**
 * 重建数据库包：只重写 manifest.json，其余条目的本地记录原样复制（包括
 * 数据描述符、extra 与本地记录之间的空隙），再按原中央目录顺序重建目录。
 */
function rewriteArchive(buf, archive, manifest, label) {
  const manifestName = Buffer.from('manifest.json', 'utf8');
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  const compressed = deflateRawSync(manifestBytes, { level: 9 });
  const manifestCrc = crc32(manifestBytes);

  const chunks = [];
  let offset = 0;
  const append = (part) => {
    chunks.push(part);
    offset += part.length;
  };
  const sorted = [...archive.entries].sort((a, b) => a.localOffset - b.localOffset);
  const newOffsets = new Map();
  let cursor = 0;

  for (let i = 0; i < sorted.length; i += 1) {
    const entry = sorted[i];
    const next = i + 1 < sorted.length ? sorted[i + 1].localOffset : archive.cdOffset;
    if (entry.localOffset < cursor || next < entry.localOffset) {
      throw new Error('ZIP 本地记录重叠或顺序异常：' + entry.name + '（' + label + '）');
    }
    append(buf.subarray(cursor, entry.localOffset));
    if (entry === archive.manifestEntry) {
      const start = offset;
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(0, 6);
      header.writeUInt16LE(8, 8);
      header.writeUInt16LE(entry.time, 10);
      header.writeUInt16LE(entry.date, 12);
      header.writeUInt32LE(manifestCrc, 14);
      header.writeUInt32LE(compressed.length, 18);
      header.writeUInt32LE(manifestBytes.length, 22);
      header.writeUInt16LE(manifestName.length, 26);
      header.writeUInt16LE(0, 28);
      append(header);
      append(manifestName);
      append(compressed);
      newOffsets.set(entry, start);
      cursor = next;
      continue;
    }
    const start = offset;
    append(buf.subarray(entry.localOffset, next));
    newOffsets.set(entry, start);
    cursor = next;
  }
  if (cursor < archive.cdOffset) append(buf.subarray(cursor, archive.cdOffset));

  const newCdOffset = offset;
  for (const entry of archive.entries) {
    const localOffset = newOffsets.get(entry);
    if (localOffset === undefined) throw new Error('ZIP 条目没有安排新位置：' + entry.name);
    const isManifest = entry === archive.manifestEntry;
    const nameBytes = isManifest ? manifestName : entry.nameBytes;
    const extra = isManifest ? Buffer.alloc(0) : entry.extra;
    const entryComment = entry.comment;
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(entry.versionMadeBy, 4);
    header.writeUInt16LE(entry.versionNeeded, 6);
    header.writeUInt16LE(isManifest ? 0 : entry.flags, 8);
    header.writeUInt16LE(isManifest ? 8 : entry.method, 10);
    header.writeUInt16LE(entry.time, 12);
    header.writeUInt16LE(entry.date, 14);
    header.writeUInt32LE(isManifest ? manifestCrc : entry.crc, 16);
    header.writeUInt32LE(isManifest ? compressed.length : entry.compressedSize, 20);
    header.writeUInt32LE(isManifest ? manifestBytes.length : entry.uncompressedSize, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt16LE(extra.length, 30);
    header.writeUInt16LE(entryComment.length, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(entry.internalAttrs, 36);
    header.writeUInt32LE(entry.externalAttrs, 38);
    header.writeUInt32LE(localOffset, 42);
    append(header);
    append(nameBytes);
    append(extra);
    append(entryComment);
  }
  const newCdSize = offset - newCdOffset;
  const eocd = Buffer.alloc(22 + archive.comment.length);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(archive.entries.length, 8);
  eocd.writeUInt16LE(archive.entries.length, 10);
  eocd.writeUInt32LE(newCdSize, 12);
  eocd.writeUInt32LE(newCdOffset, 16);
  eocd.writeUInt16LE(archive.comment.length, 20);
  append(eocd);
  if (archive.comment.length > 0) append(archive.comment);

  const result = Buffer.concat(chunks, offset);
  const check = readArchive(result, label + '（重写后）');
  const checkManifest = manifestFromArchive(check, label + '（重写后）');
  if (check.entries.length !== archive.entries.length) {
    throw new Error('重写 ZIP 后条目数不一致（' + label + '）');
  }
  if (JSON.stringify(checkManifest) !== JSON.stringify(manifest)) {
    throw new Error('重写 ZIP 后 manifest.json 校验不一致（' + label + '）');
  }
  return result;
}

function countsText(counts) {
  if (counts === null || typeof counts !== 'object') return '统计未知';
  const labels = [['articles', '文章'], ['series', '系列'], ['tags', '标签'], ['authors', '作者'], ['images', '图片']];
  const parts = [];
  for (const pair of labels) {
    if (typeof counts[pair[0]] === 'number') parts.push(pair[1] + ' ' + counts[pair[0]]);
  }
  return parts.length > 0 ? parts.join(' · ') : '统计未知';
}

function isProgramAsset(name) {
  return name.startsWith(APP + '-') && !DB_ASSET_RE.test(name);
}

function dbVersionOf(release) {
  if (release === null) return null;
  if (typeof release.tag_name === 'string' && release.tag_name.trim().length > 0) {
    return release.tag_name.trim().replace(/^v/i, '');
  }
  if (!Array.isArray(release.assets)) return null;
  for (const asset of release.assets) {
    const match = /^TouhouPeachReader-DB-(.+)\.tpr$/i.exec(asset.name);
    if (match !== null) return match[1];
  }
  return null;
}

function findSourceRelease(releases, fromTag) {
  if (fromTag !== null) {
    const found = releases.find((release) => release.tag_name === fromTag) ?? null;
    if (found === null) fail('找不到 --from-tag 指定的 Release：' + fromTag);
    if (!found.assets.some((asset) => isProgramAsset(asset.name))) {
      fail('Release ' + fromTag + ' 里没有安装包/免安装 exe');
    }
    return found;
  }
  const candidates = releases
    .filter((release) => Array.isArray(release.assets) && !release.draft && release.assets.some((asset) => isProgramAsset(asset.name)))
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
  return candidates.length > 0 ? candidates[0] : null;
}

function readNotes(path) {
  const file = resolve(process.cwd(), path);
  if (!existsSync(file)) fail('找不到 --notes 文件：' + file);
  return readFileSync(file, 'utf8');
}

function buildSummary(manifest, dbName, tag, appVersion) {
  return [
    '## 数据库 ' + dbName,
    '',
    '- 版本：' + manifest.version + '（Release 标签 ' + tag + '）',
    '- 更新时间：' + (typeof manifest.updatedAt === 'string' && manifest.updatedAt.length > 0 ? manifest.updatedAt : '未知'),
    '- 统计：' + countsText(manifest.counts),
    '',
    '> 本版只更新数据库，程序版本仍为 ' + appVersion + '；安装包与免安装 exe 沿用上一版。',
  ].join('\n');
}

async function confirmUpload(tag) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question('\n继续发布到 ' + REPO + ' ' + tag + '？[y/N] ');
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function main() {
  const { opts, positional } = parseArgs(process.argv.slice(2));
  if (opts.help) { printUsage(process.stdout); return; }
  if (positional.length > 1) usageError('一次只能传一个 .tpr 文件');
  if (opts.repo !== null) REPO = opts.repo;

  let appVersion = '未知';
  try {
    appVersion = JSON.parse(readFileSync(TAURI_CONF, 'utf8')).version;
  } catch (error) {
    fail('读不到应用版本（' + TAURI_CONF + '）：' + error.message);
  }

  const file = resolve(process.cwd(), positional.length === 1 ? positional[0] : pickDatabaseFile());
  if (!DB_ASSET_RE.test(file)) fail('不是 .tpr 文件：' + file);
  if (!existsSync(file) || !statSync(file).isFile()) fail('文件不存在：' + file);
  const originalData = readFileSync(file);
  if (originalData.byteLength === 0) fail('文件是空的：' + file);
  if (originalData.byteLength > GITHUB_MAX_BYTES) {
    fail('文件 ' + sizeText(originalData.byteLength) + '，超过 GitHub 单文件上限 2 GiB');
  }

  const archive = readArchive(originalData, file);
  const manifest = manifestFromArchive(archive, file);
  const originalVersion = typeof manifest.version === 'string' ? manifest.version : '';
  const dbName = typeof manifest.name === 'string' && manifest.name.length > 0 ? manifest.name : '未命名数据库';
  const timestamp = formatLocalTimestamp();
  const dbVersion = opts.tag !== null ? opts.tag.replace(/^v/i, '') : timestampedVersion(dbName, timestamp);
  if (dbVersion.length === 0 || dbVersion.length > MAX_VERSION_LENGTH) {
    fail('数据库版本名长度不合法（需要 1..' + MAX_VERSION_LENGTH + ' 个字符）：' + JSON.stringify(dbVersion));
  }
  const tag = opts.tag ?? 'v' + dbVersion;
  if (!isValidTag(tag)) fail('标签不合法：' + tag);
  const assetName = assetNameFor(dbVersion, timestamp);
  const newManifest = { ...manifest, version: dbVersion, updatedAt: new Date().toISOString() };
  const data = rewriteArchive(originalData, archive, newManifest, file);
  if (data.byteLength > GITHUB_MAX_BYTES) {
    fail('重写后的数据库包 ' + sizeText(data.byteLength) + '，超过 GitHub 单文件上限 2 GiB');
  }
  const digest = createHash('sha256').update(data).digest('hex');
  const title = '东方桃图吧大书库 ' + appVersion + ' · 数据库 ' + dbVersion;

  console.log('数据库包：' + file);
  console.log(
    '  ' +
      dbName +
      ' · 原版本 ' +
      (originalVersion.length > 0 ? originalVersion : '未知') +
      ' → 新版本 ' +
      dbVersion +
      ' · ' +
      sizeText(data.byteLength) +
      ' · ' +
      countsText(newManifest.counts),
  );
  console.log('  更新时间：' + newManifest.updatedAt);
  console.log('  sha256：' + digest);
  if (data.byteLength > APP_MAX_BYTES) {
    console.log('  ⚠ 超过应用内置下载上限 256 MB：桌面端「下载并导入」会报 E_TOO_LARGE，只能手动下载后再导入。');
  }
  console.log('  说明：新包的 manifest.version 已写为 ' + dbVersion + '，原标题不变；原文件不会被修改。');

  const envToken = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const credential = envToken
    ? { username: 'x-access-token', password: envToken, source: 'GH_TOKEN' }
    : storedCredential();
  AUTH = credential ? 'Basic ' + Buffer.from(credential.username + ':' + credential.password).toString('base64') : null;
  if (AUTH === null) {
    if (!opts.dryRun) fail('缺少凭据：设置 GH_TOKEN，或先让 git 能访问 GitHub（凭据管理器里有账号即可）');
    console.log('  （dry-run：没有凭据，只读公开仓库）');
  } else {
    console.log('  凭据：' + credential.source);
  }

  const listed = await api('GET', '/repos/' + REPO + '/releases?per_page=100');
  if (!listed.ok) fail('读取 Release 列表失败：HTTP ' + listed.status + ' ' + apiMessage(listed));
  const releases = Array.isArray(listed.json) ? listed.json : [];
  const target = releases.find((release) => release.tag_name === tag) ?? null;

  const existingTpr = target === null ? [] : target.assets.filter((asset) => DB_ASSET_RE.test(asset.name));
  const existingSame = existingTpr.find((asset) => asset.name === assetName) ?? null;
  const sameSize = existingSame !== null && existingSame.size === data.byteLength;

  let mode;
  let needUpload;
  let toDelete = [];
  let source = null;
  let program = [];
  let body = null;

  if (target !== null) {
    mode = '更新';
    needUpload = opts.force || !sameSize || existingTpr.length !== 1;
    if (needUpload) toDelete = existingTpr;
    if (opts.notes !== null) body = readNotes(opts.notes);
  } else {
    mode = '新建';
    needUpload = true;
    source = findSourceRelease(releases, opts.fromTag);
    if (source !== null) {
      program = source.assets
        .filter((asset) => isProgramAsset(asset.name))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    const summary = buildSummary(newManifest, dbName, tag, appVersion);
    if (opts.notes !== null) body = readNotes(opts.notes);
    else if (source !== null && typeof source.body === 'string' && source.body.trim().length > 0) {
      body = source.body.trimEnd() + '\n\n---\n\n' + summary;
    } else {
      body = summary;
    }
  }

  const programPlan = program.map((asset) => {
    const local = join(RELEASE_DIR, asset.name);
    const hasLocal = existsSync(local) && statSync(local).isFile();
    const localSize = hasLocal ? statSync(local).size : 0;
    if (hasLocal && localSize !== asset.size) {
      console.log('  ⚠ 本地 dist/release/' + asset.name + ' 与 Release 上的大小不同（' + localSize + ' / ' + asset.size + '），仍用本地文件');
    }
    return { asset, local, hasLocal, localSize };
  });

  console.log('\n发布计划');
  console.log('  目标：' + REPO + ' ' + tag + '（' + mode + ' Release）');
  console.log('  标题：' + title);
  if (mode === '更新') {
    console.log('  现有 .tpr：' + (existingTpr.length === 0 ? '无' : existingTpr.map(describeAsset).join('、')));
    if (!needUpload) {
      console.log('  资产：' + assetName + ' 同名同大小，跳过上传（要重传加 --force）');
    } else {
      if (toDelete.length > 0) console.log('  将删除：' + toDelete.map((asset) => asset.name).join('、'));
      console.log('  将上传：' + assetName + '（' + sizeText(data.byteLength) + '）');
    }
    if (opts.notes !== null) console.log('  说明：覆盖为 ' + opts.notes);
  } else {
    console.log('  将上传：' + assetName + '（' + sizeText(data.byteLength) + '）');
    if (programPlan.length === 0) console.log('  ⚠ 没有找到可复制的安装包/免安装 exe，本次只发布数据库');
    for (const item of programPlan) {
      const origin = item.hasLocal ? '本地 dist/release' : '从 ' + source.tag_name + ' 下载';
      const bytes = item.hasLocal ? item.localSize : item.asset.size;
      console.log('  程序资产：' + item.asset.name + '（' + origin + '，' + sizeText(bytes) + '）');
    }
    if (opts.notes !== null) console.log('  说明：来自 ' + opts.notes);
    else console.log('  说明：' + (source === null ? '自动生成数据库摘要' : '沿用 ' + source.tag_name + ' 的说明并追加数据库摘要'));
  }
  console.log('  发布页：https://github.com/' + REPO + '/releases/tag/' + tag);

  if (opts.dryRun) {
    console.log('\n（dry-run）没有发送任何写请求。');
    return;
  }
  if (!opts.yes) {
    if (!process.stdin.isTTY) fail('当前不是交互终端：确认无误后加 --yes 再执行（本次没有做任何修改）。');
    const confirmed = await confirmUpload(tag);
    if (!confirmed) {
      console.log('已取消，没有做任何修改。');
      return;
    }
  }

  let releaseId;
  if (target !== null) {
    releaseId = target.id;
    const patch = { name: title };
    if (opts.notes !== null) patch.body = body;
    const patched = await api('PATCH', '/repos/' + REPO + '/releases/' + releaseId, patch);
    if (!patched.ok) fail('更新 Release 标题失败：HTTP ' + patched.status + ' ' + apiMessage(patched));
    console.log('  ✓ 已更新 Release ' + (opts.notes !== null ? '标题与说明' : '标题'));
    if (needUpload) {
      for (const asset of toDelete) {
        const removed = await api('DELETE', '/repos/' + REPO + '/releases/assets/' + asset.id);
        if (!removed.ok) fail('删除旧资产 ' + asset.name + ' 失败：HTTP ' + removed.status + ' ' + apiMessage(removed));
        console.log('  − 已删除旧资产 ' + asset.name);
      }
      await upload(releaseId, { name: assetName, data });
    } else {
      console.log('  = ' + assetName + ' 同名同大小，已是最新');
    }
  } else {
    const created = await api('POST', '/repos/' + REPO + '/releases', {
      tag_name: tag,
      name: title,
      body,
      draft: false,
      prerelease: false,
      make_latest: 'true',
    });
    if (!created.ok) {
      const conflict = created.status === 422 ? '\n  标签可能已被占用：改用 --tag 指向现有标签，或先在 GitHub 上删除冲突的 Release。' : '';
      fail('创建 Release 失败：HTTP ' + created.status + ' ' + apiMessage(created) + conflict);
    }
    releaseId = created.json.id;
    console.log('  ✓ 已创建 Release ' + tag);
    console.log('  （若下面上传失败：Release 已创建，重跑本脚本会补数据库；安装包可用 corepack pnpm release:publish --tag ' + tag + ' 补齐）');
    await upload(releaseId, { name: assetName, data });
    for (const item of programPlan) {
      const assetData = item.hasLocal ? readFileSync(item.local) : await downloadAsset(item.asset);
      await upload(releaseId, { name: item.asset.name, data: assetData });
    }
  }

  const fresh = await api('GET', '/repos/' + REPO + '/releases/' + releaseId + '/assets');
  if (!fresh.ok) fail('上传后校验失败：读取资产列表 HTTP ' + fresh.status + ' ' + apiMessage(fresh));
  const assets = Array.isArray(fresh.json) ? fresh.json : [];
  const tprNow = assets.filter((asset) => DB_ASSET_RE.test(asset.name));
  const uploaded = tprNow.find((asset) => asset.name === assetName) ?? null;
  if (tprNow.length !== 1 || uploaded === null || uploaded.size !== data.byteLength) {
    const actual = tprNow.length === 0 ? '无' : tprNow.map(describeAsset).join('、');
    fail('上传后校验失败：Release 里的 .tpr 现在是 ' + actual + '，期望只有 ' + assetName + '（' + data.byteLength + ' 字节）');
  }
  console.log('  ✓ 校验通过：' + assetName + '  ' + data.byteLength + ' 字节');

  mkdirSync(RELEASE_DIR, { recursive: true });
  const localTarget = join(RELEASE_DIR, assetName);
  if (resolve(localTarget) === resolve(file)) {
    console.log('  ⚠ 输入文件就是 dist/release 里的同名包，没有覆盖原文件；本地保留的是原始包。');
  } else {
    writeFileSync(localTarget, data);
    console.log('  ✓ 已同步重写后的包到 ' + localTarget);
  }
  for (const name of readdirSync(RELEASE_DIR)) {
    const old = join(RELEASE_DIR, name);
    if (/^TouhouPeachReader-DB-.*\.tpr$/i.test(name) && name !== assetName && resolve(old) !== resolve(file)) {
      unlinkSync(old);
      console.log('  − 已清理 dist/release 里的旧数据库包 ' + name);
    }
  }

  console.log('\n✓ 发布完成');
  console.log('  标签：' + tag);
  console.log('  下载：' + uploaded.browser_download_url);
  console.log('  说明页：https://github.com/' + REPO + '/releases/tag/' + tag);
  console.log('  本地：' + localTarget);
  console.log('  sha256：' + digest);

  const previousDbVersion = target !== null ? dbVersionOf(target) : source !== null ? dbVersionOf(source) : null;
  if (previousDbVersion !== null && previousDbVersion === dbVersion) {
    console.log('\n⚠ 数据库版本没变（' + dbVersion + '）：已经导入旧库的用户点「检查更新」不会看到提示，只能手动重新下载再导入。');
  }

  const latest = await api('GET', '/repos/' + REPO + '/releases/latest');
  if (latest.ok && latest.json !== null && typeof latest.json.tag_name === 'string' && latest.json.tag_name !== tag) {
    console.log('\n⚠ 应用内置源指向 /releases/latest，当前是 ' + latest.json.tag_name + '，不是刚发布的 ' + tag + '；需要在 GitHub 上把 ' + tag + ' 设为 latest，内置下载才会指向它。');
  }

}

main().catch((error) => fail(error.message));
