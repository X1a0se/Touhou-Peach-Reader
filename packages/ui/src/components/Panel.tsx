import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface PanelProps {
  children: ReactNode;
  className?: string;
  /** `plain` 去掉半透明与阴影，用于嵌套容器 */
  tone?: 'default' | 'plain';
}

/** 卡片容器：半透明表面 + 细边框，壁纸透出来但不影响阅读（Goal 14） */
export function Panel({ children, className, tone = 'default' }: PanelProps) {
  return (
    <section
      className={cn(
        'rounded-xl border border-border',
        tone === 'default'
          ? 'bg-surface p-5 shadow-[0_1px_0_oklch(1_0_0/40%)_inset,0_18px_40px_-32px_oklch(0.2_0.03_340/60%)] backdrop-blur-sm'
          : 'bg-transparent p-0',
        className,
      )}
    >
      {children}
    </section>
  );
}
