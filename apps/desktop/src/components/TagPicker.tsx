import { type Tag, type TagCategory, normalizeName } from '@tpr/schema';
import { useState } from 'react';

export interface TagPickerProps {
  title: string;
  category: TagCategory;
  /** 当前数据库里同类别（或全部）的候选标签 */
  options: Tag[];
  value: string[];
  onChange(next: string[]): void;
  /** 新建（或复用）一个标签，返回 id；`created=false` 表示命中了已有名称/别名 */
  onCreate(name: string): Promise<{ id: string; created: boolean }>;
}

/**
 * 可新建的标签选择器：过滤 + 勾选 + 输入即新建。
 * 新建成功后会把新 id 直接勾进当前表单，不需要先保存文章。
 */
export function TagPicker({ title, category, options, value, onChange, onCreate }: TagPickerProps) {
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const needle = filter.trim();
  const key = normalizeName(needle);
  const matches = needle
    ? options.filter(
        (tag) =>
          normalizeName(tag.name).includes(key) ||
          (tag.aliases ?? []).some((alias) => normalizeName(alias).includes(key)),
      )
    : options;
  const exact = needle
    ? options.find(
        (tag) =>
          normalizeName(tag.name) === key || (tag.aliases ?? []).some((alias) => normalizeName(alias) === key),
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
      setNotice(
        result.created
          ? `已新建${category === 'character' ? '角色' : '情节'}标签「${needle}」`
          : `已复用已有标签「${exact?.name ?? needle}」`,
      );
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
        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          if (showCreate) void create();
        }}
        placeholder="搜索已有标签，或输入新名称后点「新建」"
        aria-label={`${title}：搜索或新建`}
        maxLength={60}
      />

      <div className="flex max-h-40 flex-wrap gap-x-4 gap-y-1 overflow-auto rounded-md border border-border p-2">
        {matches.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            {needle ? '没有匹配的已有标签，可直接新建。' : '还没有可选条目。'}
          </span>
        ) : null}
        {matches.map((tag) => (
          <label key={tag.id} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={value.includes(tag.id)}
              onChange={(event) => toggle(tag.id, event.target.checked)}
            />
            <span>
              {tag.name}
              {tag.aliases && tag.aliases.length > 0 ? (
                <span className="ml-1 text-[11px] text-muted-foreground">（{tag.aliases.join('、')}）</span>
              ) : null}
            </span>
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-border px-2.5 py-1 text-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
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
