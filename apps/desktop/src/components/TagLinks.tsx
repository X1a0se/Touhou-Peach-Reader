import type { TagRef } from '@tpr/core';
import { TagChip, cn } from '@tpr/ui';
import { Link } from 'react-router';

export interface TagLinksProps {
  tags: readonly TagRef[];
  /** 超过这个数量显示 +N；默认 3，传 `Number.POSITIVE_INFINITY` 表示全部 */
  limit?: number;
  className?: string;
}

/**
 * 缩略卡片上的标签组：每个标签都是独立链接，跳 `/search?q=名称`。
 * 注意：调用方不能把它放进另一个 `<Link>` 里（会形成嵌套 <a>）。
 */
export function TagLinks({ tags, limit = 3, className }: TagLinksProps) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, limit);
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
      {rest > 0 ? <span className="text-[11px] text-muted-foreground">+{rest}</span> : null}
    </span>
  );
}
