import { type DragEvent, type ReactNode, useCallback, useState } from 'react';
import { cn } from '../lib/cn.js';

export interface DropZoneProps {
  /** 浏览器/网页预览路径：直接拿到 File 列表 */
  onFiles?: (files: File[]) => void;
  /** 点击"选择文件"时触发（桌面端走 dialog.open） */
  onPick?: () => void;
  busy?: boolean;
  title?: string;
  hint?: string;
  children?: ReactNode;
  className?: string;
}

/**
 * 拖拽导入区（design §13.4）。
 * 桌面端由 Tauri 的 drag-drop 事件接管，这里主要提供视觉反馈与浏览器回退。
 */
export function DropZone({
  onFiles,
  onPick,
  busy = false,
  title = '把 .tpr 数据库包拖到这里',
  hint = '也可以点击下方按钮选择文件',
  children,
  className,
}: DropZoneProps) {
  const [over, setOver] = useState(false);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setOver(false);
      if (busy) return;
      const files = Array.from(event.dataTransfer.files ?? []);
      if (files.length > 0) onFiles?.(files);
    },
    [busy, onFiles],
  );

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!busy) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      data-busy={busy || undefined}
      className={cn(
        'flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed px-8 py-14 text-center transition-colors',
        over ? 'border-primary bg-accent' : 'border-border',
        busy && 'pointer-events-none opacity-60',
        className,
      )}
    >
      <span aria-hidden className="text-3xl">
        📚
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-base font-medium">{busy ? '正在导入…' : title}</p>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      {onPick ? (
        <button
          type="button"
          onClick={onPick}
          className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
        >
          选择 .tpr 文件
        </button>
      ) : null}
      {children}
    </div>
  );
}
