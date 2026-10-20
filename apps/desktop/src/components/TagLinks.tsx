import type { TagRef } from '@tpr/core';
import { TagChip, cn } from '@tpr/ui';
import { useState } from 'react';
import { Link } from 'react-router';

export interface TagLinksProps {
  tags: readonly TagRef[];
  /** 超过这个数量折叠成 +N；默认 3，传 `Number.POSITIVE_INFINITY` 表示全部 */
  limit?: number;
  className?: string;
}

/**
 * 缩略卡片上的标签组：每个标签都是独立链接，跳 `/search?q=名称`。
 * 超过 `limit` 时折叠为可点击的 `+N`，点击后在卡片内展开全部标签。
 * 注意：调用方不能把它放进另一个 `<Link>` / `<button>` 里（TagLinks 自身既含 `<a>` 又含展开按钮）。
 */
export function TagLinks({ tags, limit = 3, className }: TagLinksProps) {
  const [expanded, setExpanded] = useState(false);
  if (tags.length === 0) return null;
  const shown = expanded ? tags : tags.slice(0, limit);
  const rest = tags.length - shown.length;

  return (
    <span className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {shown.map((tag) => (
        <Link
          key={tag.id}
          to={`/search?q=${encodeURIComponent(tag.name)}`}
          title={`搜索「${tag.name}」`}
          className="rounded-full transition-opacity hover:opacity-75"
        >
          <TagChip name={tag.name} category={tag.category} />
        </Link>
      ))}
      {rest > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          title={`展开其余 ${rest} 个标签`}
          aria-label={`展开其余 ${rest} 个标签`}
          className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] leading-5 text-muted-foreground transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          +{rest}
        </button>
      ) : null}
    </span>
  );
}
