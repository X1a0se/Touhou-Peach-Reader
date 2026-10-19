import { Button, cn } from '@tpr/ui';
import type { DraftEnvelope } from '../editor/drafts.js';

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export interface DraftListProps {
  drafts: DraftEnvelope[];
  selectedId?: string | null;
  onOpen(draft: DraftEnvelope): void;
  onDelete(id: string): void;
}

/** 编辑器里的草稿箱列表：点整行打开，右侧 ✕ 删除 */
export function DraftList({ drafts, selectedId, onOpen, onDelete }: DraftListProps) {
  if (drafts.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-dashed border-border bg-surface/40 p-3">
      <p className="text-xs font-medium text-muted-foreground">草稿（{drafts.length}）</p>
      <ul className="flex flex-col gap-1">
        {drafts.map((draft) => (
          <li key={draft.id} className="flex items-center gap-1">
            <button
              type="button"
              aria-label={`打开草稿《${draft.label}》`}
              onClick={() => onOpen(draft)}
              className={cn(
                'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                draft.id === selectedId
                  ? 'bg-accent-soft text-accent'
                  : 'hover:bg-surface-strong text-foreground/90',
              )}
            >
              <span className="truncate">{draft.label || '未命名'}</span>
              <span className="ml-auto shrink-0 text-[0.65rem] text-muted-foreground">
                {formatTime(draft.updatedAt)}
              </span>
            </button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`删除草稿《${draft.label}》`}
              onClick={() => onDelete(draft.id)}
              className="h-7 w-7 px-0 text-muted-foreground"
            >
              ✕
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
