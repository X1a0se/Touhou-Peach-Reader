import { cn } from '../lib/cn.js';

export interface StatTileProps {
  label: string;
  value: string | number;
  hint?: string;
  className?: string;
}

/** 计数格：数据库概览用（文章/系列/作者…） */
export function StatTile({ label, value, hint, className }: StatTileProps) {
  return (
    <div className={cn('rounded-lg border border-border bg-surface/60 px-3 py-2.5', className)}>
      <p className="text-[0.7rem] tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">{value}</p>
      {hint !== undefined && <p className="text-[0.7rem] text-muted-foreground">{hint}</p>}
    </div>
  );
}
