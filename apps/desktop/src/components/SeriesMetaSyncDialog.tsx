import type { SeriesMetaSyncItem } from '@tpr/core';
import { SERIES_AUTO_FILL_FIELDS, type SeriesAutoFillField } from '@tpr/schema';
import { Button } from '@tpr/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { META_SYNC_FIELD_LABEL, type MetaSyncGroup, metaSyncKey } from '../editor/meta-sync.js';

export interface SeriesAutoFillFieldPickerProps {
  value: SeriesAutoFillField[];
  onChange(next: SeriesAutoFillField[]): void;
  /** 拼进 `id`/`htmlFor` 的前缀，避免表单与弹窗里出现重复 id */
  idPrefix: string;
}

/**
 * 「未来加入本系列的文章自动填上」的四个复选框：顺序固定取 `SERIES_AUTO_FILL_FIELDS`，
 * 与弹窗里的分组标题、表单里的复选框共用同一份字段顺序。
 *
 * 纯受控：勾选结果由 `value` 决定，`onChange` 给出的是按声明顺序归一后的新数组。
 */
export function SeriesAutoFillFieldPicker({
  value,
  onChange,
  idPrefix,
}: SeriesAutoFillFieldPickerProps) {
  const toggle = (field: SeriesAutoFillField, checked: boolean): void => {
    const next = new Set(value);
    if (checked) next.add(field);
    else next.delete(field);
    onChange(SERIES_AUTO_FILL_FIELDS.filter((item) => next.has(item)));
  };

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {SERIES_AUTO_FILL_FIELDS.map((field) => {
        const id = `${idPrefix}-${field}`;
        return (
          <label key={field} htmlFor={id} className="flex items-center gap-2 text-sm">
            <input
              id={id}
              type="checkbox"
              className="h-4 w-4 accent-[var(--accent)]"
              checked={value.includes(field)}
              onChange={(event) => toggle(field, event.target.checked)}
            />
            <span>{META_SYNC_FIELD_LABEL[field]}</span>
          </label>
        );
      })}
    </div>
  );
}

export interface SeriesMetaSyncDialogProps {
  seriesTitle: string;
  /** 系列当前（保存后）的篇数，用在标题里 */
  memberCount: number;
  /** 本次新加入的篇数：它们不在 `groups` 里，已按自动填策略处理 */
  newMemberCount: number;
  groups: readonly MetaSyncGroup[];
  /** 文章 id → 标题；由调用方用快照构造，弹窗自己不查库 */
  articleTitles: ReadonlyMap<string, string>;
  autoFillFields: SeriesAutoFillField[];
  onAutoFillFieldsChange(next: SeriesAutoFillField[]): void;
  onConfirm(items: SeriesMetaSyncItem[]): void;
  onSkip(): void;
  onCancel(): void;
}

/** 组内每条候选的选择键。 */
function groupKeys(group: MetaSyncGroup): string[] {
  return group.items.map((item) => metaSyncKey(item.articleId, item.field));
}

/** 默认选中：`fill` 组全选，`replace` 组全不选（覆盖已有值必须用户主动勾）。 */
function defaultSelection(groups: readonly MetaSyncGroup[]): Set<string> {
  const keys = new Set<string>();
  for (const group of groups) {
    if (group.kind !== 'fill') continue;
    for (const key of groupKeys(group)) keys.add(key);
  }
  return keys;
}

interface MetaSyncSectionProps {
  title: string;
  /** 区块默认展开与否；补全展开、替换折叠 */
  open: boolean;
  groups: readonly MetaSyncGroup[];
  articleTitles: ReadonlyMap<string, string>;
  selected: ReadonlySet<string>;
  onToggle(keys: readonly string[], checked: boolean): void;
}

interface MetaSyncGroupBlockProps {
  group: MetaSyncGroup;
  /** 初始展开状态；补全组展开、替换组折叠 */
  defaultOpen: boolean;
  articleTitles: ReadonlyMap<string, string>;
  selected: ReadonlySet<string>;
  onToggle(keys: readonly string[], checked: boolean): void;
}

/** 一组候选：可折叠的 `<summary>` 标题 + 三态组复选框 + 逐篇复选框。 */
function MetaSyncGroupBlock({
  group,
  defaultOpen,
  articleTitles,
  selected,
  onToggle,
}: MetaSyncGroupBlockProps) {
  const keys = groupKeys(group);
  const selectedCount = keys.filter((key) => selected.has(key)).length;
  const all = keys.length > 0 && selectedCount === keys.length;
  const some = selectedCount > 0 && !all;

  return (
    <details
      open={defaultOpen ? true : undefined}
      className="rounded-lg border border-border bg-surface/40 px-2.5 py-1.5"
    >
      <summary className="cursor-pointer text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{META_SYNC_FIELD_LABEL[group.field]}</span>{' '}
        {group.fromLabel} → {group.toLabel}（{group.items.length} 篇）
      </summary>

      <label className="mt-1 flex items-center gap-2 px-1.5 py-1 text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="h-4 w-4 shrink-0 accent-[var(--accent)]"
          checked={all}
          aria-label={`全选本组（${group.items.length} 篇）`}
          ref={(node) => {
            // `indeterminate` 只能通过 DOM 属性设，React 没有对应道具
            if (node) node.indeterminate = some;
          }}
          onChange={(event) => onToggle(keys, event.target.checked)}
        />
        <span>全选本组（{group.items.length} 篇）</span>
      </label>

      <ul className="flex flex-col">
        {group.items.map((item) => {
          const key = metaSyncKey(item.articleId, item.field);
          return (
            <li key={key}>
              <label className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-surface-strong">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                  checked={selected.has(key)}
                  onChange={(event) => onToggle([key], event.target.checked)}
                />
                <span className="min-w-0 flex-1 truncate">
                  {articleTitles.get(item.articleId) ?? item.articleId}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** 一个区块：标题 + 「全选 / 全不选」+ 若干组。 */
function MetaSyncSection({
  title,
  open,
  groups,
  articleTitles,
  selected,
  onToggle,
}: MetaSyncSectionProps) {
  if (groups.length === 0) return null;
  const sectionKeys = groups.flatMap(groupKeys);
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {title}
          <span className="ml-2 text-xs font-normal text-muted-foreground">{total} 篇</span>
        </h3>
        <div className="flex items-center gap-3 text-xs">
          <button
            type="button"
            className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => onToggle(sectionKeys, true)}
          >
            全选
          </button>
          <button
            type="button"
            className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => onToggle(sectionKeys, false)}
          >
            全不选
          </button>
        </div>
      </div>

      {groups.map((group) => (
        <MetaSyncGroupBlock
          key={group.key}
          group={group}
          defaultOpen={open}
          articleTitles={articleTitles}
          selected={selected}
          onToggle={onToggle}
        />
      ))}
    </section>
  );
}

/**
 * 保存系列前的确认弹窗：把系列的四个字段逐篇同步到系列内的文章。
 *
 * 纯展示组件——候选与标题都由调用方算好传进来，这里不做任何库 / 快照访问。
 * 默认勾选「补全空字段」，不勾「替换已有值」；「未来自动填上」的复选框即本次保存要落库的策略。
 */
export function SeriesMetaSyncDialog({
  seriesTitle,
  memberCount,
  newMemberCount,
  groups,
  articleTitles,
  autoFillFields,
  onAutoFillFieldsChange,
  onConfirm,
  onSkip,
  onCancel,
}: SeriesMetaSyncDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [selected, setSelected] = useState<Set<string>>(() => defaultSelection(groups));

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const toggle = (keys: readonly string[], checked: boolean): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  };

  const fillGroups = groups.filter((group) => group.kind === 'fill');
  const replaceGroups = groups.filter((group) => group.kind === 'replace');

  const confirm = (): void => {
    const items: SeriesMetaSyncItem[] = [];
    for (const group of groups) {
      for (const item of group.items) {
        if (selected.has(metaSyncKey(item.articleId, item.field))) {
          items.push({ articleId: item.articleId, field: item.field });
        }
      }
    }
    onConfirm(items);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-xl outline-none"
      >
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="text-base font-semibold">
            同步到《{seriesTitle}》内 {memberCount} 篇文章
          </h2>
          <p className="text-xs text-muted-foreground">
            勾选要跟着系列一起改的文章字段；「替换已有值」会覆盖文章原来的内容。
          </p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">没有需要确认的改动。</p>
          ) : null}

          <MetaSyncSection
            title="补全空字段"
            open
            groups={fillGroups}
            articleTitles={articleTitles}
            selected={selected}
            onToggle={toggle}
          />
          <MetaSyncSection
            title="替换已有值"
            open={false}
            groups={replaceGroups}
            articleTitles={articleTitles}
            selected={selected}
            onToggle={toggle}
          />

          <section className="flex flex-col gap-2 border-t border-border pt-3">
            <h3 className="text-sm font-semibold">未来加入本系列的文章自动填上</h3>
            <SeriesAutoFillFieldPicker
              value={autoFillFields}
              onChange={onAutoFillFieldsChange}
              idPrefix="series-meta-sync-dialog"
            />
          </section>
        </div>

        {newMemberCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            另有 {newMemberCount} 篇是本次新加入的，已按「未来自动填上」的策略填了空字段。
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button variant="primary" onClick={confirm}>
            同步并保存
          </Button>
          <Button variant="secondary" onClick={onSkip}>
            仅保存系列
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            取消
          </Button>
        </div>
      </div>
    </div>
  );
}
