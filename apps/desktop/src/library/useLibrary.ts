import { suggestExportFileName, type DBSnapshot, type ExportSelection, type Services } from '@tpr/core';
import type { Issue } from '@tpr/schema';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  downloadTprFile,
  onTauriDrop,
  pickTprFile,
  pickTprSavePath,
  readFileBytes,
  stageTprFile,
} from '../platform/files.js';

export type LibraryStatus = 'loading' | 'empty' | 'ready';

export interface LibraryState {
  status: LibraryStatus;
  snapshot: DBSnapshot | null;
  busy: boolean;
  message: string | null;
  error: string | null;
  warnings: Issue[];
  importBytes(bytes: Uint8Array): Promise<void>;
  importPath(path: string): Promise<void>;
  exportAll(): Promise<void>;
  /** 导出单篇/选中（Goal 10）。 */
  exportSelection(selection: ExportSelection): Promise<void>;
  pickAndImport(): Promise<void>;
  /** 编辑器写完内存后来刷新 Provider 里的 snapshot（不重读磁盘）。 */
  refresh(): Promise<void>;
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const describeImport = (snapshot: DBSnapshot, mergedTags: number): string => {
  const merged = mergedTags > 0 ? `，自动合并 ${mergedTags} 组同名标签` : '';
  return `已导入「${snapshot.manifest.name}」：${snapshot.articles.length} 篇文章、${snapshot.series.length} 个系列${merged}`;
};

export function useLibrary(services: Services): LibraryState {
  const [status, setStatus] = useState<LibraryStatus>('loading');
  const [snapshot, setSnapshot] = useState<DBSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Issue[]>([]);
  const imported = useRef(false);

  // 启动即恢复上次打开的库：这是"重启应用后数据还在"的验收路径
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const restored = await services.library.restore();
        if (cancelled) return;
        setSnapshot(restored);
        setStatus(restored ? 'ready' : 'empty');
      } catch (cause) {
        if (cancelled) return;
        setError(describe(cause));
        setStatus('empty');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [services]);

  const importBytes = useCallback(
    async (bytes: Uint8Array) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const outcome = await services.library.importBytes(bytes);
        imported.current = true;
        setSnapshot(outcome.snapshot);
        setWarnings([...outcome.report.warnings]);
        setStatus('ready');
        setMessage(describeImport(outcome.snapshot, outcome.mergedTags));
      } catch (cause) {
        setError(describe(cause));
      } finally {
        setBusy(false);
      }
    },
    [busy, services],
  );

  const importPath = useCallback(
    async (path: string) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      setMessage(null);
      let staged: string | null = null;
      try {
        // 外部路径（桌面拖入 / 文件对话框）先复制进 app data，Rust 解压只认 app data 内的路径。
        staged = await stageTprFile(path);
        const outcome = await services.library.importZip(staged);
        imported.current = true;
        setSnapshot(outcome.snapshot);
        setWarnings([...outcome.report.warnings]);
        setStatus('ready');
        setMessage(describeImport(outcome.snapshot, outcome.mergedTags));
      } catch (cause) {
        setError(describe(cause));
      } finally {
        if (staged && staged !== path) {
          await services.platform.fs.remove(staged).catch(() => undefined);
        }
        setBusy(false);
      }
    },
    [busy, services],
  );

  const pickAndImport = useCallback(async () => {
    const path = await pickTprFile();
    if (path) await importPath(path);
  }, [importPath]);

  const exportSelection = useCallback(
    async (selection: ExportSelection) => {
      if (!snapshot) return;
      setBusy(true);
      setError(null);
      try {
        if (services.platform.kind === 'tauri') {
          // 桌面端：先选目标，再让 Rust 直接把工作目录写成 .tpr；ZIP 不进 JS。
          const target = await pickTprSavePath(suggestExportFileName(snapshot.manifest.name));
          if (!target) return;
          const result = await services.library.exportToPath(selection, target);
          setWarnings((prev) => [...prev, ...result.warnings]);
          setMessage(`已导出到 ${target}`);
        } else {
          // 浏览器预览：保留字节下载回退，只适合小库。
          const result = await services.library.export(selection);
          const saved = await downloadTprFile(result.fileName, result.bytes);
          setWarnings((prev) => [...prev, ...result.warnings]);
          setMessage(`已导出到 ${saved}`);
        }
      } catch (cause) {
        setError(describe(cause));
      } finally {
        setBusy(false);
      }
    },
    [services, snapshot],
  );

  const exportAll = useCallback(async () => {
    await exportSelection({ all: true });
  }, [exportSelection]);

  const refresh = useCallback(async () => {
    setSnapshot(services.library.snapshot());
  }, [services]);

  return {
    status,
    snapshot,
    busy,
    message,
    error,
    warnings,
    importBytes,
    importPath,
    exportAll,
    exportSelection,
    pickAndImport,
    refresh,
  };
}

/** 桌面端原生拖拽 → 路径导入（Tauri 拦截了 HTML5 drop）。 */
export function useNativeDrop(onPaths: (paths: string[]) => void): void {
  useEffect(() => onTauriDrop(onPaths), [onPaths]);
}

export { readFileBytes };
