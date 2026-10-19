import { normalizeName } from '@tpr/schema';
import { useState } from 'react';

export interface PickerOption {
  id: string;
  name: string;
  aliases?: readonly string[] | undefined;
}

export interface CreatablePickerProps {
  title: string;
  options: readonly PickerOption[];
  value: readonly string[];
  onChange(next: string[]): void;
  /** 新建（或复用）一个条目，返回 id；`created=false` 表示命中了已有名称/别名 */
  onCreate(name: string): Promise<{ id: string; created: boolean }>;
  /** 输入框占位文案 */
  placeholder?: string;
  /** 没有任何候选时的提示 */
  emptyHint?: string;
  /** 新建/复用后的提示文案 */
  noticeFor(name: string, created: boolean, matchedName: string | undefined): string;
}

/**
 * 通用的「可新建选择器」：过滤 + 精确命中判重 + 输入即新建 + 复选列表。
 * TagPicker / AuthorPicker 都是它的薄包装，保证新建交互只有一份实现。
 */
export function CreatablePicker({
  title,
  options,
  value,
  onChange,
  onCreate,
  placeholder = '搜索已有条目，或输入新名称后点「新建」',
  emptyHint = '还没有可选条目。',
  noticeFor,
}: CreatablePickerProps) {
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const needle = filter.trim();
  const key = normalizeName(needle);
  const matches = needle
    ? options.filter(
        (option) =>
          normalizeName(option.name).includes(key) ||
          (option.aliases ?? []).some((alias) => normalizeName(alias).includes(key)),
      )
    : options;
  const exact = needle
    ? options.find(
        (option) =>
          normalizeName(option.name) === key ||
          (option.aliases ?? []).some((alias) => normalizeName(alias) === key),
      )
    : undefined;
  const showCreate = needle !== '' && !exact;

  const create = async (): Promise<void> => {
    if (!needle || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await onCreate(needle);
      if (!value.includes(result.id)) onChange([...value, result.id]);
      setFilter('');
      setNotice(noticeFor(needle, result.created, exact?.name));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string, checked: boolean) => {
    setNotice(null);
    onChange(checked ? [...value, id] : value.filter((item) => item !== id));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
      <input
        className="w-full rounded-lg border border-border bg-surface/60 px-3 py-1.5 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-[var(--ring)]"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          if (showCreate) void create();
        }}
        placeholder={placeholder}
        aria-label={`${title}：搜索或新建`}
        maxLength={60}
      />

      <div className="flex max-h-40 flex-wrap gap-x-4 gap-y-1 overflow-auto rounded-lg border border-border bg-surface/40 p-2">
        {matches.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            {needle ? '没有匹配的已有条目，可直接新建。' : emptyHint}
          </span>
        ) : null}
        {matches.map((option) => (
          <label key={option.id} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={value.includes(option.id)}
              onChange={(event) => toggle(option.id, event.target.checked)}
            />
            <span>
              {option.name}
              {option.aliases && option.aliases.length > 0 ? (
                <span className="ml-1 text-[11px] text-muted-foreground">（{option.aliases.join('、')}）</span>
              ) : null}
            </span>
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-lg border border-border px-2.5 py-1 text-xs transition-colors hover:bg-surface-strong disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void create()}
          disabled={!showCreate || busy}
        >
          {busy ? '新建中…' : showCreate ? `+ 新建「${needle}」` : '+ 新建'}
        </button>
        {notice ? <span className="text-xs text-emerald-700 dark:text-emerald-300">{notice}</span> : null}
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
    </div>
  );
}
