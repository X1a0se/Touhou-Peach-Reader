import { isR18Tag, type Tag } from '@tpr/schema';
import { R18Badge } from '@tpr/ui';
import { useState } from 'react';

export interface R18FieldProps {
  /** 当前选中的情节标签 id */
  plotTagIds: string[];
  /** 库内所有情节标签；用于识别主名或别名是 R18 的标签 */
  plotTags: Tag[];
  onChange(ids: string[]): void;
  /** 库内还没有 R18 标签时新建一个；返回新标签 id */
  onCreate(name: string): Promise<{ id: string; created: boolean }>;
  disabled?: boolean;
}

/**
 * 情节标签里的 R18 快捷选项：勾选即把 R18 加进情节标签，取消则移除所有 R18 情节标签。
 * 始终与下方 TagPicker 双向同步，不单独维护状态。
 */
export function R18Field({ plotTagIds, plotTags, onChange, onCreate, disabled = false }: R18FieldProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r18Ids = plotTags.filter((tag) => isR18Tag(tag)).map((tag) => tag.id);
  const checked = r18Ids.some((id) => plotTagIds.includes(id));

  const toggle = async (next: boolean) => {
    if (busy || disabled) return;
    setError(null);
    if (!next) {
      onChange(plotTagIds.filter((id) => !r18Ids.includes(id)));
      return;
    }
    const existing = r18Ids.find((id) => plotTagIds.includes(id)) ?? r18Ids[0];
    if (existing) {
      if (!plotTagIds.includes(existing)) onChange([...plotTagIds, existing]);
      return;
    }
    setBusy(true);
    try {
      const result = await onCreate('R18');
      onChange(plotTagIds.includes(result.id) ? plotTagIds : [...plotTagIds, result.id]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-red-600"
          checked={checked}
          disabled={disabled || busy}
          onChange={(event) => void toggle(event.target.checked)}
        />
        <span className="font-medium text-red-700 dark:text-red-300">R18 内容</span>
        <R18Badge />
        {busy ? <span className="text-xs text-muted-foreground">正在准备标签…</span> : null}
      </label>
      <p className="pl-6 text-xs text-muted-foreground">
        勾选会自动在情节标签中选中 R18；取消会移除情节标签里的所有 R18。
      </p>
      {error ? <p className="pl-6 text-xs text-destructive">无法添加 R18 标签：{error}</p> : null}
    </div>
  );
}
