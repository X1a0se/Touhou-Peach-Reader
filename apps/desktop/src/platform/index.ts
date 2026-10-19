import type { Platform } from '@tpr/platform';
import { createMemoryPlatform } from '@tpr/platform/memory';
import { createTauriPlatform } from './tauri.js';

/**
 * 平台选择：在 Tauri 窗口里注入真实实现，在浏览器（pnpm dev:web）里注入内存实现。
 * 这样前端可以脱离 Rust 独立开发与截图。
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function createPlatform(): Promise<Platform> {
  return isTauri() ? createTauriPlatform() : createMemoryPlatform({ dataDir: '/appdata' });
}
