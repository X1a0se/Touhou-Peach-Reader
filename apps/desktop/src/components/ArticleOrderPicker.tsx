import type { ArticleMeta } from '@tpr/schema';
import { useState } from 'react';

export interface ArticleOrderPickerProps {
  articles: readonly ArticleMeta[];
  value: string[];
  onChange(next: string[]): void;
}

/**
 * 系列目录编辑器：编号即 `articleIds` 的顺序。
 * 不用拖拽（键盘可用的上移/下移足够，也避免新增依赖）。
 */
export function ArticleOrderPicker({ articles, value, onChange }: ArticleOrderPickerProps) {
  const [filter, setFilter] = useState('');

  const byId = new Map(articles.map((article) => [article.id, article]));
  const selected = new Set(value);
  const needle = filter.trim().toLowerCase();
  const candidates = articles.filter(
    (article) => !selected.has(article.id) && (needle === '' || article.title.toLowerCase().includes(needle)),
  );

  const move = (index: number, delta: number): void => {
    const next = [...value];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [item] = next.splice(index, 1);
    if (item === undefined) return;
    next.splice(target, 0, item);
    onChange(next);
  };

  const remove = (id: string): void => onChange(value.filter((item) => item !== id));
  const add = (id: string): void => {
    if (selected.has(id)) return;
    onChange([...value, id]);
    setFilter('');
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">目录（编号即文章顺序）</span>
        <span className="text-xs text-muted-foreground">{value.length} 篇</span>
      </div>

      {value.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          还没有文章。从下面的列表里添加，或用「文章」标签页新建。
        </p>
      ) : (
        <ol className="flex flex-col gap-1 rounded-lg border border-border bg-surface/40 p-2">
          {value.map((id, index) => {
            const article = byId.get(id);
            return (
              <li key={id} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-surface-strong">
                <span className="w-7 shrink-0 font-mono text-xs text-muted-foreground">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className={`min-w-0 flex-1 truncate ${article ? '' : 'text-destructive'}`}>
                  {article?.title ?? `缺失的文章 ${id}`}
                </span>
                <button
                  type="button"
                  className="rounded border border-border px-1.5 text-xs disabled:opacity-40"
                  aria-label={`上移《${article?.title ?? id}》`}
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="rounded border border-border px-1.5 text-xs disabled:opacity-40"
                  aria-label={`下移《${article?.title ?? id}》`}
                  onClick={() => move(index, 1)}
                  disabled={index === value.length - 1}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="rounded border border-destructive/40 px-1.5 text-xs text-destructive"
                  aria-label={`移除《${article?.title ?? id}》`}
                  onClick={() => remove(id)}
                >
                  移除
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <input
        className="w-full rounded-lg border border-border bg-surface/60 px-3 py-1.5 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-[var(--ring)]"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="搜索要加入目录的文章"
        aria-label="搜索要加入目录的文章"
        maxLength={120}
      />
      <div className="flex max-h-36 flex-wrap gap-2 overflow-auto rounded-lg border border-border bg-surface/40 p-2">
        {candidates.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            {needle ? '没有匹配的文章。' : '所有文章都已在目录里。'}
          </span>
        ) : null}
        {candidates.map((article) => (
          <button
            key={article.id}
            type="button"
            className="rounded-full border border-border px-2.5 py-0.5 text-xs transition-colors hover:bg-surface-strong"
            aria-label={`添加《${article.title}》`}
            onClick={() => add(article.id)}
          >
            + {article.title}
          </button>
        ))}
      </div>
    </div>
  );
}
