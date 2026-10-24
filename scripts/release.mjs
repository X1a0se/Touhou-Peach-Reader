#!/usr/bin/env node
/**
 * 发布一致性工具（Goal 19）。
 *
 * 背景：Tauri 没有"增量更新"；`tauri build` 只产出新的免安装 exe 与 NSIS 安装包，
 * **不会**自动替换已安装到 `D:\Touhou Peach Reader`（或其它 `InstallLocation`）的副本。
 * 所以版本号散落在 5 个文件里，必须有一个单一入口来 bump / 构建 / 覆盖安装 / 核对。
 *
 * 用法：
 *   node scripts/release.mjs release    一条命令：check + build + 覆盖安装版 + 刷新 dist/portable（并同步便携镜像）+ 核对
 *   node scripts/release.mjs status     只核对版本与目录，不改任何文件
 *   node scripts/release.mjs build      跑 check + tauri build（产物在 target/release）
 *   node scripts/release.mjs install    把 NSIS 安装包静默装到注册表里的 InstallLocation
 *   node scripts/release.mjs portable   只刷新 dist/portable（免安装交付目录）
 *   node scripts/release.mjs            等价于 status
 *   node scripts/release.mjs --set 0.2.0  统一写 5 个版本号文件（不改代码）
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_ID = 'com.touhou.peachreader';
const UNINSTALL_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Touhou Peach Reader';
const PORTABLE_EXE = join(ROOT, 'apps/desktop/src-tauri/target/release/touhou-peach-reader.exe');
const NSIS_DIR = join(ROOT, 'apps/desktop/src-tauri/target/release/bundle/nsis');
const DIST_DIR = join(ROOT, 'dist');
const PORTABLE_DIR = join(DIST_DIR, 'portable');
const PORTABLE_NAME = 'Touhou Peach Reader.exe';
/** 便携版镜像目录：每次刷新 dist/portable 后同步过去（TPR_PORTABLE_MIRROR 可覆盖） */
const MIRROR_DIR = process.env.TPR_PORTABLE_MIRROR ?? 'D:\\Touhou Peach Reader Portable';
const TAURI_CONF = join(ROOT, 'apps/desktop/src-tauri/tauri.conf.json');
const CARGO_TOML = join(ROOT, 'apps/desktop/src-tauri/Cargo.toml');

const args = process.argv.slice(2);
const command = args[0] ?? 'status';

const fail = (message) => {
  console.error(`\n✖ ${message}`);
  process.exit(1);
};

function run(bin, argv, options = {}) {
  const result = spawnSync(bin, argv, {
    stdio: 'inherit',
    shell: process.platform === 'win32' && bin === 'corepack',
    ...options,
  });
  if (result.status !== 0) fail(`${bin} ${argv.join(' ')} 退出码 ${result.status ?? result.signal}`);
}

function read(file) {
  return readFileSync(file, 'utf8');
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex').toUpperCase();
}

/** 从 5 处读取版本：根 package.json、core、desktop、tauri.conf.json、Cargo.toml。 */
function readVersions() {
  const pkg = (path) => JSON.parse(read(path)).version;
  const cargo = /^\s*version\s*=\s*"([^"]+)"/m.exec(read(CARGO_TOML))?.[1] ?? '?';
  return {
    root: pkg(join(ROOT, 'package.json')),
    core: pkg(join(ROOT, 'packages/core/package.json')),
    desktop: pkg(join(ROOT, 'apps/desktop/package.json')),
    tauri: JSON.parse(read(TAURI_CONF)).version,
    cargo,
  };
}

function writeVersions(version) {
  const patchJson = (file) => {
    const text = read(file);
    const next = text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`);
    if (next === text) fail(`${file} 里没找到 "version"`);
    writeFileSync(file, next, 'utf8');
  };
  patchJson(join(ROOT, 'package.json'));
  patchJson(join(ROOT, 'packages/core/package.json'));
  patchJson(join(ROOT, 'apps/desktop/package.json'));
  patchJson(TAURI_CONF);

  const cargoText = read(CARGO_TOML);
  const nextCargo = cargoText.replace(/^(\s*version\s*=\s*")[^"]+(")/m, `$1${version}$2`);
  if (nextCargo === cargoText) fail(`${CARGO_TOML} 里没找到 version`);
  writeFileSync(CARGO_TOML, nextCargo, 'utf8');
  console.log(`已把 5 处版本号写为 ${version}（记得 pnpm install 更新 lockfile 里的 workspace 版本）。`);
}

/** Windows 可执行文件里的 FileVersion（与 tauri.conf 的 version 同源）。 */
function exeVersion(file) {
  if (!existsSync(file)) return null;
  const script = 'Get-Item -LiteralPath $env:TPR_EXE | ForEach-Object { $_.VersionInfo.FileVersion }';
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', env: { ...process.env, TPR_EXE: file } },
  );
  if (result.status !== 0) return '?';
  return result.stdout.trim() || '?';
}

/** 注册表里的安装位置与版本（只读）。 */
function installedInfo() {
  const result = spawnSync('reg', ['query', UNINSTALL_KEY], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const text = result.stdout;
  const location = (/InstallLocation\s+REG_SZ\s+(.+)/.exec(text)?.[1] ?? '')
    .trim()
    .replace(/^"|"$/g, '');
  const version = (/DisplayVersion\s+REG_SZ\s+(.+)/.exec(text)?.[1] ?? '').trim();
  const exe = location ? join(location, 'touhou-peach-reader.exe') : '';
  return {
    location,
    version,
    exe,
    exists: Boolean(exe && existsSync(exe)),
    fileVersion: exe && existsSync(exe) ? exeVersion(exe) : null,
    sha: exe && existsSync(exe) ? sha256(exe) : null,
  };
}

function newestInstaller() {
  if (!existsSync(NSIS_DIR)) return null;
  const files = readdirSync(NSIS_DIR)
    .filter((name) => name.toLowerCase().endsWith('.exe'))
    .map((name) => join(NSIS_DIR, name));
  if (files.length === 0) return null;
  files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0];
}

function line(label, value, note = '') {
  console.log(`  ${label.padEnd(14, ' ')} ${String(value ?? '—').padEnd(28, ' ')} ${note}`);
}

function manifestOf(dir) {
  const file = join(dir, 'manifest.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(read(file));
  } catch {
    return null;
  }
}

function status() {
  const versions = readVersions();
  const target = versions.root;
  const portable = existsSync(PORTABLE_EXE) ? exeVersion(PORTABLE_EXE) : null;
  const portableSha = existsSync(PORTABLE_EXE) ? sha256(PORTABLE_EXE) : null;
  const installer = newestInstaller();
  const installed = installedInfo();
  const folder = manifestOf(PORTABLE_DIR);
  const folderExe = join(PORTABLE_DIR, PORTABLE_NAME);
  const mirror = manifestOf(MIRROR_DIR);
  const mirrorExe = join(MIRROR_DIR, PORTABLE_NAME);

  console.log('\nTouhou Peach Reader · 发布一致性\n');
  line('根 package', versions.root);
  line('core', versions.core);
  line('desktop', versions.desktop);
  line('tauri.conf', versions.tauri);
  line('Cargo.toml', versions.cargo);
  line('构建产物', portable, portable ? PORTABLE_EXE.split('target\\release\\')[1] ?? '' : '尚未构建');
  if (portableSha) line('  哈希', portableSha.slice(0, 16), `${Math.round(statSync(PORTABLE_EXE).size / 1024)} KB`);
  line('安装包', installer ? `${(statSync(installer).size / 1024 / 1024).toFixed(2)} MB` : '尚未构建', installer ?? '');
  if (folder && existsSync(folderExe)) {
    line('免安装目录', `${folder.version}（文件 ${exeVersion(folderExe)}）`, PORTABLE_DIR);
  } else {
    line('免安装目录', '未打包', '运行 pnpm release:portable 或 pnpm release');
  }
  if (mirror && existsSync(mirrorExe)) {
    line('便携镜像', `${mirror.version}（文件 ${exeVersion(mirrorExe)}）`, MIRROR_DIR);
  } else {
    line('便携镜像', existsSync(MIRROR_DIR) ? '未同步' : '目录不存在', MIRROR_DIR);
  }
  if (installed) {
    line('安装版', `${installed.version}（文件 ${installed.fileVersion}）`, installed.location);
    if (installed.sha) line('  哈希', installed.sha.slice(0, 16));
  } else {
    line('安装版', '未安装', '(运行 pnpm release:install 会装到注册表位置)');
  }

  const problems = [];
  for (const key of ['core', 'desktop', 'tauri', 'cargo']) {
    if (versions[key] !== target) problems.push(`${key} 版本 ${versions[key]} ≠ ${target}`);
  }
  if (portable !== target) problems.push(`构建产物版本 ${portable ?? '缺失'} ≠ ${target}`);
  if (!folder) problems.push(`免安装目录未打包（期望 dist/portable 里是 ${target}）`);
  else if (folder.version !== target) problems.push(`免安装目录版本 ${folder.version} ≠ ${target}`);
  if (existsSync(MIRROR_DIR)) {
    if (!mirror) problems.push(`便携镜像未同步（${MIRROR_DIR} 里没有 manifest.json）`);
    else if (mirror.version !== target) problems.push(`便携镜像版本 ${mirror.version} ≠ ${target}`);
    else if (!existsSync(mirrorExe)) problems.push(`便携镜像缺少 ${PORTABLE_NAME}`);
    else if (existsSync(folderExe) && sha256(mirrorExe) !== sha256(folderExe)) {
      problems.push(`便携镜像的 ${PORTABLE_NAME} 与 dist/portable 不一致`);
    }
  }
  if (!installed) problems.push('尚未安装（安装版不存在）');
  else {
    if (installed.version !== target) problems.push(`安装版注册版本 ${installed.version} ≠ ${target}`);
    if (installed.fileVersion !== target) problems.push(`安装版文件版本 ${installed.fileVersion} ≠ ${target}`);
  }

  // 哈希只能作参考：tauri 在打完 NSIS 之后还会改写免安装 exe 的 bundle type 标记，
  // 两者字节必然不同（大小通常一致），因此版本号才是判据。
  const hashNote =
    installed?.sha && portableSha && installed.sha !== portableSha
      ? '提示：安装版与构建产物哈希不同属正常（NSIS 打包会改写 bundle type 标记），以版本号为准。'
      : null;

  console.log('');
  if (problems.length === 0) {
    console.log(`✔ 一致：安装版与免安装目录都是 ${target}`);
    console.log(`  免安装版：${folderExe}`);
    if (existsSync(MIRROR_DIR)) console.log(`  便携镜像：${MIRROR_DIR}`);
    console.log(`  安装版：  ${join(installed.location, 'touhou-peach-reader.exe')}`);
    if (hashNote) console.log(`  ${hashNote}`);
    return 0;
  }
  console.log('✖ 不一致：');
  for (const problem of problems) console.log(`   - ${problem}`);
  console.log('\n修复：`pnpm release`（= 构建 + 刷新 dist/portable 并同步便携镜像 + 覆盖安装 + 核对）。');
  return 1;
}

function build() {
  const pids = runningProcesses();
  if (pids.length > 0) {
    fail(
      `应用正在运行（PID ${pids.join(', ')}），Windows 会锁住 target\\release\\touhou-peach-reader.exe，无法覆盖。\n   请先退出 Touhou Peach Reader，再重跑 pnpm release:build。`,
    );
  }
  const env = {
    ...process.env,
    PATH: `${join(homedir(), '.cargo', 'bin')};${process.env.PATH ?? ''}`,
  };
  console.log('▶ corepack pnpm check');
  run('corepack', ['pnpm', 'check'], { env });
  console.log('▶ tauri build（apps/desktop）');
  run('corepack', ['pnpm', 'tauri', 'build'], { cwd: join(ROOT, 'apps/desktop'), env });
}

function runningProcesses() {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', "Get-Process touhou-peach-reader -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"],
    { encoding: 'utf8' },
  );
  return (result.stdout ?? '').trim().split(/\s+/).filter(Boolean);
}

function install(quiet = false) {
  const versions = readVersions();
  const installer = newestInstaller();
  if (!installer) fail('找不到 NSIS 安装包，先跑 pnpm release:build');
  if (!existsSync(PORTABLE_EXE)) fail('找不到免安装 exe，先跑 pnpm release:build');

  const installerName = basename(installer);
  if (!installerName.includes(versions.root)) {
    fail(`安装包 ${installerName} 与版本 ${versions.root} 不匹配：先统一版本号再构建`);
  }

  const pids = runningProcesses();
  if (pids.length > 0) {
    fail(`应用正在运行（PID ${pids.join(', ')}）。请先退出 Touhou Peach Reader 再覆盖安装。`);
  }

  const installed = installedInfo();
  const target = installed?.location || join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData/Local'), 'Touhou Peach Reader');
  console.log(`▶ 静默安装 ${installerName}\n  目标目录 ${target}`);
  const result = spawnSync(installer, ['/S', `/D=${target}`], {
    stdio: 'inherit',
    windowsVerbatimArguments: true,
  });
  if (result.status !== 0) fail(`安装器退出码 ${result.status}`);

  // NSIS 是异步解压的，等新 exe 落地再核对；静默安装在本机可能直接退出 0 而不落盘。
  const exe = join(target, 'touhou-peach-reader.exe');
  for (let i = 0; i < 40; i += 1) {
    if (existsSync(exe) && exeVersion(exe) === versions.root) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  const actual = existsSync(exe) ? exeVersion(exe) : null;
  if (actual !== versions.root) {
    fail(
      `安装未生效：${exe} 的版本是 ${actual ?? '缺失'}，期望 ${versions.root}。\n` +
        `   本机 NSIS 静默安装可能不落盘，请手动运行 ${installerName} 完成 GUI 安装。`,
    );
  }
  console.log(`✔ 已安装到 ${target}\n`);
  return quiet ? 0 : status();
}

/** 把免安装 exe、安装包与运行说明收进 `dist/portable/`，给不装机的用户一个固定入口。 */
function packagePortable() {
  const versions = readVersions();
  const installer = newestInstaller();
  if (!existsSync(PORTABLE_EXE)) fail('找不到免安装 exe，先跑 pnpm release:build');
  if (!installer) fail('找不到 NSIS 安装包，先跑 pnpm release:build');

  rmSync(PORTABLE_DIR, { recursive: true, force: true });
  mkdirSync(PORTABLE_DIR, { recursive: true });

  const exeTarget = join(PORTABLE_DIR, PORTABLE_NAME);
  copyFileSync(PORTABLE_EXE, exeTarget);
  copyFileSync(installer, join(PORTABLE_DIR, basename(installer)));

  const readme = [
    `Touhou Peach Reader ${versions.root}（免安装版）`,
    '',
    `运行：双击「${PORTABLE_NAME}」`,
    '数据：%APPDATA%\\com.touhou.peachreader（与安装版共用，升级不会丢库）',
    '升级：在仓库根目录双击「发布更新.cmd」，或执行 corepack pnpm release',
    '',
    '本目录由 scripts/release.mjs 自动生成，请不要手动修改。',
    '',
  ].join('\r\n');
  writeFileSync(join(PORTABLE_DIR, 'README.txt'), readme, 'utf8');

  const manifest = {
    version: versions.root,
    builtAt: new Date().toISOString(),
    exe: PORTABLE_NAME,
    sha256: sha256(exeTarget),
    installer: basename(installer),
  };
  writeFileSync(join(PORTABLE_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`✔ 免安装目录已刷新：${PORTABLE_DIR}\n`);
  mirrorPortable();
}

/**
 * 把刚刷新好的 `dist/portable` 同步到便携版镜像目录。
 * 只复制顶层文件，不动镜像里的 data/、backup/ 等子目录；镜像目录不存在时跳过并说明原因。
 */
function mirrorPortable() {
  if (process.platform !== 'win32') return;
  if (!existsSync(MIRROR_DIR)) {
    console.log(`  跳过便携镜像：${MIRROR_DIR} 不存在（可用 TPR_PORTABLE_MIRROR 指定其他目录）\n`);
    return;
  }

  const files = readdirSync(PORTABLE_DIR).filter((name) => statSync(join(PORTABLE_DIR, name)).isFile());
  for (const name of files) {
    try {
      copyFileSync(join(PORTABLE_DIR, name), join(MIRROR_DIR, name));
    } catch (error) {
      fail(
        `无法写入便携镜像 ${join(MIRROR_DIR, name)}：${error.code ?? error.message}\n` +
          '   如果应用正从该目录运行，请先退出 Touhou Peach Reader 再重试。',
      );
    }
  }
  console.log(`✔ 便携镜像已同步（${files.length} 个文件）：${MIRROR_DIR}\n`);
}

/** 一条命令：构建 → 刷新免安装目录（含便携镜像）→ 覆盖安装版 → 核对。 */
function release() {
  const pids = runningProcesses();
  if (pids.length > 0) {
    fail(
      `应用正在运行（PID ${pids.join(', ')}）。\n   请先退出 Touhou Peach Reader，再重跑 pnpm release（或双击「发布更新.cmd」）。`,
    );
  }
  build();
  // 先刷新 dist/portable 与便携镜像：即便后面的 NSIS 安装失败，免安装交付物也是最新的
  packagePortable();
  install(true);
  return status();
}

if (command === '--set') {
  const version = args[1];
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail('用法：node scripts/release.mjs --set 0.1.1');
  writeVersions(version);
  process.exit(0);
}

if (command === 'build') {
  build();
  process.exit(status());
}

if (command === 'install') {
  process.exit(install());
}

if (command === 'portable') {
  packagePortable();
  process.exit(status());
}

if (command === 'release') {
  process.exit(release());
}

if (command === 'status') {
  process.exit(status());
}

console.log(`未知命令：${command}`);
console.log('可用：status | build | install | portable | release | --set <x.y.z>');
process.exit(2);
