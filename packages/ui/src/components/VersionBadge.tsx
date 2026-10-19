import { cn } from '../lib/cn.js';

export interface VersionBadgeProps {
  version: string;
  className?: string;
}

export function VersionBadge({ version, className }: VersionBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground',
        className,
      )}
    >
      v{version}
    </span>
  );
}
