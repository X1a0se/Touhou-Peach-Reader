import type { Series } from '@tpr/schema';
import { normalizeName } from '@tpr/schema';
import { useState } from 'react';
import { useServices } from '../context.js';
import { useLibraryContext } from '../library/LibraryProvider.js';

export interface SeriesPickerProps {
  series: readonly Series[];
  value: string;
  onChange(seriesId: string): void;
}

const inputClass =
  'w-full rounded-lg border border-border bg-surface/60 px-3 py-1.5 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-[var(--ring)]';

/**
 * 系列选择器 + 内联新建（article 编辑页用）。
 * 标题按 `normalizeName` 判重：命中已有系列时直接选中，不产生重复系列。
 */
export function SeriesPicker({ series, value, onChange }: SeriesPickerProps) {
  const services = useServices();
  const { refresh } = useLibraryContext();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async (): Promise<void> => {
    const name = title.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const key = normalizeName(name);
      const existed = series.find((item) => normalizeName(item.title) === key);
      if (existed) {
        onChange(existed.id);
        setNotice(`已复用已有系列「${existed.title}」`);
      } else {
        const id = await services.editor.saveSeries({
          title: name,
          summary: '',
          status: 'ongoing',
          articleIds: [],
          authorIds: [],
          characterTagIds: [],
          plotTagIds: [],
        });
        await refresh();
        onChange(id);
        setNotice(`已新建系列「${name}」，保存文章后会加在目录末尾`);
      }
      setTitle('');
      setCreating(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <select
          className={inputClass}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label="系列"
        >
          <option value="">不属于系列</option>
          {series.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-surface-strong"
          onClick={() => {
            setCreating((open) => !open);
            setNotice(null);
            setError(null);
          }}
        >
          {creating ? '收起' : '+ 新建系列'}
        </button>
      </div>

      {creating ? (
        <div className="flex items-center gap-2">
          <input
            className={inputClass}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              void create();
            }}
            placeholder="系列标题，例如「东方红魔乡」"
            aria-label="新建系列标题"
            maxLength={120}
          />
          <button
            type="button"
            className="shrink-0 rounded-lg bg-primary px-2.5 py-1.5 text-xs text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void create()}
            disabled={busy || !title.trim()}
          >
            {busy ? '新建中…' : '新建并选中'}
          </button>
        </div>
      ) : null}

      {notice ? <span className="text-xs text-emerald-700 dark:text-emerald-300">{notice}</span> : null}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
