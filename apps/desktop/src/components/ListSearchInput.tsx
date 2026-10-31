import { cn } from '@tpr/ui';

export interface ListSearchInputProps {
  value: string;
  onChange(next: string): void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
}

/** 多选列表/面板里的小型搜索框；Escape 清空。 */
export function ListSearchInput({
  value,
  onChange,
  placeholder = '搜索…',
  ariaLabel,
  className,
}: ListSearchInputProps) {
  return (
    <input
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onChange('');
        }
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={cn(
        'w-full rounded-lg border border-border bg-surface/60 px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-[var(--ring)]',
        className,
      )}
    />
  );
}
