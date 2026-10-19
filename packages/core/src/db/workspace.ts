import { PlatformError, type Platform } from '@tpr/platform';
import type { DbIo } from './layout.js';

export const DB_LAYOUT = {
  workspaceDir: 'workspace',
  importsDir: 'imports',
  exportsDir: 'exports',
  userDir: 'user',
  activeFile: 'active.json',
} as const;

export function ioFor(platform: Platform): DbIo {
  return { fs: platform.fs, join: (...parts: string[]) => platform.paths.join(...parts) };
}

export interface ActivePointer {
  databaseId: string;
  openedAt: string;
}

export function activePath(platform: Platform): string {
  return platform.paths.join(platform.paths.dataDir, DB_LAYOUT.activeFile);
}

export function userPath(platform: Platform, databaseId: string): string {
  return platform.paths.join(platform.paths.dataDir, DB_LAYOUT.userDir, `${databaseId}.json`);
}

export function workspacePath(platform: Platform, databaseId: string): string {
  return platform.paths.join(platform.paths.dataDir, DB_LAYOUT.workspaceDir, databaseId);
}

export async function readActive(platform: Platform): Promise<ActivePointer | null> {
  const path = activePath(platform);
  if (!(await platform.fs.exists(path))) return null;
  try {
    const value = JSON.parse(await platform.fs.readText(path)) as Partial<ActivePointer>;
    if (typeof value.databaseId !== 'string' || value.databaseId.length === 0) return null;
    return { databaseId: value.databaseId, openedAt: typeof value.openedAt === 'string' ? value.openedAt : '' };
  } catch {
    return null;
  }
}

export async function writeActive(platform: Platform, databaseId: string): Promise<void> {
  const path = activePath(platform);
  const tmp = `${path}.tmp`;
  const pointer: ActivePointer = { databaseId, openedAt: new Date().toISOString() };
  await platform.fs.writeText(tmp, `${JSON.stringify(pointer, null, 2)}\n`);
  await platform.fs.rename(tmp, path);
}

/** Windows 上目录可能被杀软/预览窗格短暂占用：指数退避重试（§9.3）。 */
async function withRetry<T>(action: () => Promise<T>, delays = [50, 100, 200, 400, 800]): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      const delay = delays[attempt];
      if (delay === undefined) break;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

export async function commitWorkspace(platform: Platform, staging: string, databaseId: string): Promise<void> {
  const target = workspacePath(platform, databaseId);
  const backup = `${target}.bak-${Date.now()}`;
  const hadTarget = await platform.fs.exists(target);
  if (hadTarget) await withRetry(() => platform.fs.rename(target, backup));
  try {
    await withRetry(() => platform.fs.rename(staging, target));
  } catch (error) {
    if (hadTarget && (await platform.fs.exists(backup))) {
      await platform.fs.rename(backup, target).catch(() => undefined);
    }
    throw new PlatformError('EIO', '导入失败：无法替换本地数据库目录（请关闭占用该目录的程序）', error);
  }
  if (hadTarget && (await platform.fs.exists(backup))) {
    await withRetry(() => platform.fs.remove(backup, { recursive: true })).catch(() => undefined);
  }
  await writeActive(platform, databaseId);
}

export async function listWorkspaces(platform: Platform): Promise<string[]> {
  const root = platform.paths.join(platform.paths.dataDir, DB_LAYOUT.workspaceDir);
  if (!(await platform.fs.exists(root))) return [];
  const entries = await platform.fs.listDir(root);
  return entries.filter((e) => e.isDirectory && !e.name.includes('.bak-')).map((e) => e.name);
}

export async function removeTree(platform: Platform, path: string): Promise<void> {
  if (await platform.fs.exists(path)) {
    await platform.fs.remove(path, { recursive: true }).catch(() => undefined);
  }
}
