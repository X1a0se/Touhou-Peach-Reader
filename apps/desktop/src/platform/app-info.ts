import { invoke } from '@tauri-apps/api/core';

/**
 * 运行时信息（Goal 19/20）：版本、当前 exe、app data 目录、安装版位置。
 *
 * 浏览器预览（`pnpm dev:web`）没有 Tauri 命令，返回 null，由调用方降级显示。
 */
export interface InstallInfo {
  /** 注册表里的 InstallLocation */
  location: string;
  /** 注册表里的 DisplayVersion（安装包版本，不一定等于当前 exe） */
  version: string;
}

export type RunMode = 'installed' | 'portable';

export interface AppRuntimeInfo {
  /** 编译进 exe 的版本（Cargo/tauri.conf 同源） */
  version: string;
  /** 当前运行的 exe 绝对路径 */
  exePath: string;
  dataDir: string;
  /** 本机是否装过安装版；没装过为 null */
  install: InstallInfo | null;
  /** 当前 exe 是否就是注册表里的安装版 */
  mode: RunMode;
}

/** 去掉 Windows 的 `\\?\` 前缀、统一分隔符与大小写，便于比较目录前缀。 */
function normalizePath(path: string): string {
  return path
    .replace(/^\\\\\?\\/, '')
    .replace(/\//g, '\\')
    .replace(/\\+$/, '')
    .toLowerCase();
}

/**
 * 判断当前 exe 属于安装版还是免安装版。
 *
 * 判据是「exe 是否位于注册表记录的那个安装目录下」，而不是路径里有没有
 * `target\release`——发布脚本会把免安装版复制到 `dist\portable`。
 */
export function resolveRunMode(exePath: string, installLocation: string | null): RunMode {
  if (!installLocation) return 'portable';
  const exe = normalizePath(exePath);
  const root = normalizePath(installLocation);
  if (!root) return 'portable';
  return exe === root || exe.startsWith(`${root}\\`) ? 'installed' : 'portable';
}

/**
 * 能不能调用 Tauri 命令。
 *
 * 这里直接检查 `__TAURI_INTERNALS__.invoke`，而不是复用 `platform/index.ts` 的
 * `isTauri()`：后者只判断 `__TAURI_INTERNALS__` 是否存在，打包后曾出现「门开
 * 着但实际不认」的情况；真正要用的就是 invoke 本身。
 */
export function hasTauriInvoke(): boolean {
  if (typeof window === 'undefined') return false;
  const internals = (window as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__;
  return typeof internals?.invoke === 'function';
}

/** 等 Tauri 注入 `__TAURI_INTERNALS__`（窗口刚创建时可能还没就绪）。 */
async function waitForInvoke(timeoutMs = 4000): Promise<boolean> {
  const start = Date.now();
  while (!hasTauriInvoke()) {
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('IPC 超时（Tauri 未响应）')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export interface RuntimeInfoOptions {
  /** 等 `__TAURI_INTERNALS__` 注入的最长时间 */
  waitMs?: number;
  /** IPC 重试次数（冷启动时前几秒 invoke 会一直 pending） */
  attempts?: number;
  /** 单次 invoke 超时 */
  timeoutMs?: number;
  /** 两次重试之间的间隔 */
  gapMs?: number;
}

async function loadAppRuntimeInfo(options: RuntimeInfoOptions = {}): Promise<AppRuntimeInfo | null> {
  const { waitMs = 15_000, attempts = 5, timeoutMs = 5_000, gapMs = 800 } = options;
  if (!(await waitForInvoke(waitMs))) return null;
  // 冷启动时 WebView2 可能先渲染、Tauri IPC 后可用：前几秒 invoke 会一直
  // pending（实测 5–8 秒才恢复），所以这里带重试，UI 侧显示「读取中」。
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const [info, install] = await withTimeout(
        Promise.all([
          invoke<{ version: string; exePath: string; dataDir: string }>('app_info'),
          invoke<InstallInfo | null>('install_info').catch(() => null),
        ]),
        timeoutMs,
      );
      return {
        ...info,
        install,
        mode: resolveRunMode(info.exePath, install?.location ?? null),
      };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
  }
  console.warn('[app-info] 读取运行时信息失败', lastError);
  return null;
}

/**
 * 运行时信息按进程缓存：设置页反复挂载、快速切页都只读一次。
 * 读取失败不缓存，下次挂载还能重试；成功结果直到应用重启才失效。
 */
let runtimeInfoPromise: Promise<AppRuntimeInfo | null> | null = null;

export function getAppRuntimeInfo(
  options: RuntimeInfoOptions = {},
): Promise<AppRuntimeInfo | null> {
  runtimeInfoPromise ??= loadAppRuntimeInfo(options).then((value) => {
    if (value === null) runtimeInfoPromise = null;
    return value;
  });
  return runtimeInfoPromise;
}

/** 测试专用：清空缓存，下次重新读取。 */
export function resetAppRuntimeInfoCache(): void {
  runtimeInfoPromise = null;
}
