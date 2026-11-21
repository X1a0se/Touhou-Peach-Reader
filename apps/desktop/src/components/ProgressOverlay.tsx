import type { ProgressUpdate } from '@tpr/core';
import { ProgressBar } from '@tpr/ui';
import { cn } from '@tpr/ui';

const TITLES: Record<ProgressUpdate['kind'], string> = {
  import: '导入数据库',
  merge: '合并数据库',
  export: '导出数据库',
  download: '下载数据库',
};

/**
 * 全局进度浮层（Goal 31）。
 *
 * 导入 / 导出既可能从按钮触发，也可能是拖入 .tpr 触发，入口分散；
 * 统一挂在 Layout 里只渲染一份，用户在任何页面都能看到同一份进度与剩余时间。
 */
export function ProgressOverlay({ progress }: { progress: ProgressUpdate | null }) {
  if (!progress) return null;
  const percent = Math.round(progress.fraction * 100);
  return (
    <div
      aria-live="polite"
      data-testid="progress-overlay"
      className={cn(
        'pointer-events-none fixed right-5 bottom-5 z-40 w-[min(22rem,calc(100vw-2.5rem))]',
        'rounded-2xl border border-border bg-surface p-4 shadow-[0_18px_40px_-24px_oklch(0.2_0.03_340/55%)] backdrop-blur-md',
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <span aria-hidden className="text-base">
          {progress.kind === 'merge' ? '⇄' : progress.kind === 'export' ? '⤓' : '↺'}
        </span>
        <span className="text-xs font-semibold tracking-wide text-muted-foreground">
          {TITLES[progress.kind]}
        </span>
        <span className="ml-auto font-mono text-[0.7rem] text-muted-foreground tabular-nums">
          {percent}%
        </span>
      </div>
      <ProgressBar
        size="sm"
        value={progress.fraction}
        etaMs={progress.etaMs}
        label={progress.label}
        {...(progress.detail !== undefined ? { detail: progress.detail } : {})}
      />
    </div>
  );
}
