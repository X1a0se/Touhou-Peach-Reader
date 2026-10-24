import { normalizeTagName } from '@tpr/core';
import type { Tag } from '@tpr/schema';
import { useMemo, useState } from 'react';
import {
  filterSearchTags,
  TAG_CATEGORY_LABEL,
  TAG_CATEGORY_ORDER,
  TAG_FILTER_LIMIT,
  tagDisplayName,
} from './tags.js';

export interface SearchTagFilterProps {
  tags: readonly Tag[];
  selected: readonly string[];
  onToggle(name: string): void;
  onClear(): void;
}

const chipClass =
  'inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent-soft px-2 py-0.5 text-xs text-accent';

/**
 * 多标签筛选（Goal 25）：选中的标签按 AND 组合；标签名用归一化值，
 * 展示时优先取库里的原始写法。默认收起，展开后可搜索名称/别名/分类。
 */
export function SearchTagFilter({ tags, selected, onToggle, onClear }: SearchTagFilterProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const result = useMemo(() => filterSearchTags(tags, filter), [tags, filter]);
  const groups = useMemo(
    () =>
      TAG_CATEGORY_ORDER.map((category) => ({
        category,
        items: result.items.filter((tag) => tag.category === category),
      })).filter((group) => group.items.length > 0),
    [result.items],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="search-tag-picker"
          onClick={() => setOpen((value) => !value)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-strong"
        >
          <span aria-hidden>🏷️</span>
          标签筛选{selected.length > 0 ? `（${selected.length}）` : ''}
          <span aria-hidden className="text-[0.6rem] text-muted-foreground">
            {open ? '▲' : '▼'}
          </span>
        </button>
        {selected.length > 0 ? (
          <span className="text-xs text-muted-foreground">同时满足以下标签</span>
        ) : (
          <span className="text-xs text-muted-foreground">可多选，结果需同时满足</span>
        )}
        {selected.map((name) => {
          const label = tagDisplayName(name, tags);
          return (
            <span key={name} className={chipClass}>
              #{label}
              <button
                type="button"
                aria-label={`移除标签 ${label}`}
                onClick={() => onToggle(name)}
                className="rounded-full px-0.5 leading-none hover:text-foreground"
              >
                ×
              </button>
            </span>
          );
        })}
        {selected.length > 0 ? (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            清除全部
          </button>
        ) : null}
      </div>

      {open ? (
        <div
          id="search-tag-picker"
          className="rounded-xl border border-border bg-surface/60 p-3 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="搜索标签名、别名或分类…"
              aria-label="搜索可筛选的标签"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-[var(--ring)]"
            />
            <span className="text-xs text-muted-foreground">
              已选 {selected.length} 个 · 结果需同时满足
            </span>
          </div>

          <div className="mt-2 max-h-64 overflow-y-auto">
            {groups.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                没有匹配的标签。
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.category} className="flex flex-col gap-0.5 py-1">
                  <span className="px-2 py-1 text-[0.68rem] font-medium tracking-wide text-muted-foreground uppercase">
                    {TAG_CATEGORY_LABEL[group.category]}
                  </span>
                  {group.items.map((tag) => {
                    const checked = selected.includes(normalizeTagName(tag.name));
                    return (
                      <label
                        key={tag.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-strong"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggle(tag.name)}
                          className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                        />
                        <span className="truncate">{tag.name}</span>
                        {(tag.aliases ?? []).length > 0 ? (
                          <span className="ml-auto truncate text-xs text-muted-foreground">
                            {(tag.aliases ?? []).join('、')}
                          </span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {result.total > result.items.length ? (
            <p className="mt-2 text-xs text-muted-foreground">
              仅显示前 {TAG_FILTER_LIMIT} 个（共 {result.total} 个），继续输入可缩小范围。
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
