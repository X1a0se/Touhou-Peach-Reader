import { cn } from '../lib/cn.js';

export interface R18BadgeProps {
  className?: string;
}

/** 文章/系列含 R18 情节时的红色徽章。 */
export function R18Badge({ className }: R18BadgeProps) {
  return (
    <span
      aria-label="含 R18 情节"
      title="含 R18 情节"
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border border-red-500/50 bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold leading-5 text-red-700 dark:border-red-500/40 dark:text-red-300',
        className,
      )}
    >
      R18
    </span>
  );
}
