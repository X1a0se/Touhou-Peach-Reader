import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

/** 页面小标题：eyebrow（可选）+ 标题 + 描述 + 右侧操作 */
export function SectionHeading({
  eyebrow,
  title,
  description,
  actions,
  className,
}: SectionHeadingProps) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        {eyebrow !== undefined && (
          <p className="text-[0.68rem] font-semibold tracking-[0.18em] text-accent uppercase">
            {eyebrow}
          </p>
        )}
        <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        {description !== undefined && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
