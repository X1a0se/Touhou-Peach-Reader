import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open, save } from '@tauri-apps/plugin-dialog';
import { isTauri } from './index.js';

/**
 * 文件选择/保存对话框与拖拽订阅（Goal 3）。
 * 这是除 `tauri.ts` 之外第二处允许 import @tauri-apps/* 的文件 —— 都在 apps/desktop 内，
 * core / ui / schema 仍然零 Tauri 依赖（scripts/check-no-tauri.mjs 会守住）。
 */

export const TPR_FILTER = [{ name: '东方桃图吧大书库数据库', extensions: ['tpr'] }];

export const WALLPAPER_FILTER = [
  { name: '图片（PNG / JPEG / WebP）', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
];

/** 选一张壁纸；返回绝对路径，取消则 null（Goal 14）。 */
export async function pickWallpaperFile(): Promise<string | null> {
  if (!isTauri()) return null;
  const selected = await open({ multiple: false, directory: false, filters: WALLPAPER_FILTER });
  return typeof selected === 'string' ? selected : null;
}

/** 选一个 .tpr；返回绝对路径，取消则 null。 */
export async function pickTprFile(): Promise<string | null> {
  if (!isTauri()) return null;
  const selected = await open({ multiple: false, directory: false, filters: TPR_FILTER });
  return typeof selected === 'string' ? selected : null;
}

/** 只弹保存对话框，返回目标路径；取消则 null（实际写入由 zip_create_from_dir_to 完成）。 */
export async function pickTprSavePath(fileName: string): Promise<string | null> {
  if (!isTauri()) return null;
  const target = await save({ defaultPath: fileName, filters: TPR_FILTER });
  return target === null ? null : target;
}

/** 浏览器预览的下载回退；返回下载文件名。 */
export async function downloadTprFile(fileName: string, bytes: Uint8Array): Promise<string> {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
  return fileName;
}

/**
 * 订阅窗口拖拽：Tauri 会拦截原生 drop，HTML5 的 onDrop 不会触发。
 * 返回取消订阅函数。
 */
export function onTauriDrop(handler: (paths: string[]) => void): () => void {
  if (!isTauri()) return () => undefined;
  let disposed = false;
  const pending = getCurrentWebview().onDragDropEvent((event) => {
    if (disposed) return;
    if (event.payload.type === 'drop') {
      const paths = event.payload.paths.filter((p) => p.toLowerCase().endsWith('.tpr'));
      if (paths.length > 0) handler(paths);
    }
  });
  return () => {
    disposed = true;
    void pending.then((unlisten) => unlisten()).catch(() => undefined);
  };
}

/** 读取 File 的字节（浏览器拖拽回退路径）。 */
export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/**
 * 把外部 `.tpr` 复制进 app data（Goal 18）。
 *
 * 拖入 / 对话框选中的路径在 app data 之外，而 Rust 侧的解压、合并命令只接受 app data 内的
 * 路径；这里先让 Rust 复制一份到 `imports/staged-*.tpr`，用完由调用方删除。
 * 浏览器预览没有原生路径，原样返回（走 `importBytes` 分支）。
 */
export async function stageTprFile(sourcePath: string): Promise<string> {
  if (!isTauri()) return sourcePath;
  return invoke<string>('stage_import', { sourcePath });
}
