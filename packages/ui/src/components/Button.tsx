import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-50 border border-transparent',
  secondary:
    'border border-border bg-surface text-foreground hover:bg-surface-strong disabled:opacity-50',
  ghost: 'border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
  danger: 'border border-red-500/30 bg-red-500/10 text-red-600 hover:bg-red-500/20 dark:text-red-300',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
};

/** 统一按钮：替代各页面里散落的 buttonClass/primaryClass 字符串（Goal 14） */
export function Button({ variant = 'secondary', size = 'md', className, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    />
  );
}
