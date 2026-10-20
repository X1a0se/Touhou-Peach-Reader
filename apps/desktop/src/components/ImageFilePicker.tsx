import { cn } from '@tpr/ui';
import { useRef, useState } from 'react';
import { IMAGE_ACCEPT, MAX_IMAGE_BYTES, validateImageFile } from '../editor/images.js';

export interface ImageFilePickerProps {
  file: File | null;
  onChange(file: File | null): void;
  disabled?: boolean;
  label?: string;
  hint?: string;
}

/**
 * 编辑器里的图片选择按钮。
 *
 * Tauri 会拦截原生文件 drop，且全局 drop 只接收 .tpr，所以这里只做点击选择，
 * 不承诺拖拽上传；大号虚线区域 + 主题色标题就是「显眼」的来源。
 */
export function ImageFilePicker({
  file,
  onChange,
  disabled = false,
  label = '选择图片',
  hint = `支持 PNG / JPEG / WebP / GIF，最大 ${MAX_IMAGE_BYTES / 1024 / 1024} MB`,
}: ImageFilePickerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = (next: File | undefined): void => {
    if (!next) return;
    const message = validateImageFile(next);
    if (message !== null) {
      setError(message);
      return;
    }
    setError(null);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'flex w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors',
          'border-accent/60 bg-accent-soft/30 hover:border-accent hover:bg-accent-soft/60',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span aria-hidden className="text-2xl leading-none">
          🖼️
        </span>
        <span className="text-sm font-semibold text-accent">
          {file ? '重新选择图片' : label}
        </span>
        <span className="max-w-full truncate text-xs text-muted-foreground">
          {file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : hint}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.files?.[0];
          event.target.value = '';
          pick(next);
        }}
      />
      {error !== null ? <span className="text-xs text-red-500">{error}</span> : null}
    </div>
  );
}
