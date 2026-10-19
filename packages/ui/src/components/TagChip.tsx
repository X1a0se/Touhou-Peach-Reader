import type { TagCategory } from '@tpr/schema';
import { cn } from '../lib/cn.js';

export interface TagChipProps {
  name: string;
  category: TagCategory;
  className?: string;
  /** 悬停提示，默认用名称（长标签被截断时有用） */
  title?: string;
}

const CATEGORY_CLASS: Record<TagCategory, string> = {
  character:
    'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  plot: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  series:
    'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200',
  general: 'border-border bg-muted/60 text-muted-foreground',
};

/** 标签芯片的基础样式；缩略卡片与详情页共用，保证同一类别颜色一致。 */
export function tagChipClass(category: TagCategory): string {
  return cn(
    'inline-flex max-w-full items-center truncate rounded-full border px-2 py-0.5 text-[11px] leading-5',
    CATEGORY_CLASS[category],
  );
}

/** 纯展示的标签芯片：不包含链接，点击行为由调用方决定（`@tpr/ui` 不依赖路由）。 */
export function TagChip({ name, category, className, title }: TagChipProps) {
  return (
    <span className={cn(tagChipClass(category), className)} title={title ?? name}>
      {name}
    </span>
  );
}
