import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: string;
  className?: string;
}

/** 空态：虚线框 + 一句解释 + 可选操作 */
export function EmptyState({ title, description, action, icon = '🌸', className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface/40 px-6 py-10 text-center',
        className,
      )}
    >
      <span aria-hidden className="text-2xl">
        {icon}
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description !== undefined && (
        <p className="max-w-md text-xs text-muted-foreground">{description}</p>
      )}
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  );
}
