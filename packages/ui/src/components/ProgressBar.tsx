import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface ProgressBarProps {
  /** 0..1；不确定进度时传 undefined 并把 `indeterminate` 设成 true */
  value?: number;
  label?: ReactNode;
  detail?: ReactNode;
  /** 预计剩余毫秒；null / undefined 表示还在估算 */
  etaMs?: number | null;
  /** 不确定进度：显示来回滚动的条 */
  indeterminate?: boolean;
  /** 紧凑模式：浮层里用，字号更小 */
  size?: 'sm' | 'md';
  className?: string;
}

/** 预计剩余时间的口语化文本：不足 1 秒不显示，避免"0 秒"闪一下。 */
export function formatEta(etaMs: number | null | undefined): string {
  if (etaMs === null || etaMs === undefined || !Number.isFinite(etaMs)) return '';
  if (etaMs < 1000) return '马上完成';
  const seconds = Math.ceil(etaMs / 1000);
  if (seconds < 60) return `预计剩余 ${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `预计剩余 ${minutes} 分钟` : `预计剩余 ${minutes} 分 ${rest} 秒`;
}

/**
 * 统一进度条（Goal 31）：导入 / 合并 / 导出共用。
 *
 * 用原生 `<progress>` 的语义（role + aria-value*）保证读屏器能读，
 * 视觉上叠一层渐变让它跟主题的 accent 一致。
 */
export function ProgressBar({
  value,
  label,
  detail,
  etaMs,
  indeterminate = false,
  size = 'md',
  className,
}: ProgressBarProps) {
  const percent = indeterminate ? 0 : Math.round(Math.min(1, Math.max(0, value ?? 0)) * 100);
  const eta = formatEta(etaMs);
  return (
    <div className={cn('w-full', className)}>
      {label || !indeterminate ? (
        <div className="flex items-baseline justify-between gap-3">
          <span
            className={cn(
              'min-w-0 truncate font-medium text-foreground',
              size === 'sm' ? 'text-xs' : 'text-sm',
            )}
          >
            {label}
          </span>
          <span
            className={cn(
              'shrink-0 tabular-nums text-muted-foreground',
              size === 'sm' ? 'text-[0.7rem]' : 'text-xs',
            )}
          >
            {indeterminate ? '进行中…' : (`${percent}%${eta ? ` · ${eta}` : ''}`)}
          </span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : percent}
        aria-valuetext={indeterminate ? '进行中' : `${percent}%${eta ? `，${eta}` : ''}`}
        className={cn(
          'mt-1.5 overflow-hidden rounded-full bg-muted',
          size === 'sm' ? 'h-1.5' : 'h-2',
        )}
      >
        <div
          className={cn(
            'h-full rounded-full bg-accent transition-[width] duration-300 ease-out',
            indeterminate && 'animate-pulse',
          )}
          style={{ width: indeterminate ? '100%' : `${percent}%` }}
        />
      </div>
      {detail ? (
        <p
          className={cn(
            'mt-1 truncate text-muted-foreground',
            size === 'sm' ? 'text-[0.7rem]' : 'text-xs',
          )}
        >
          {detail}
        </p>
      ) : null}
    </div>
  );
}
