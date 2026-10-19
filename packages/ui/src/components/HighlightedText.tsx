import { cn } from '../lib/cn.js';

export interface HighlightedTextProps {
  /** 由 core 的 `buildSnippets` 产出的片段；这里只认结构，不依赖 core 类型 */
  parts: ReadonlyArray<{ text: string; highlighted: boolean }>;
  className?: string;
}

/** 高亮片段：命中词用 `<mark>`，其余保持原样（design §11.6） */
export function HighlightedText({ parts, className }: HighlightedTextProps) {
  return (
    <span className={cn('text-muted-foreground', className)}>
      {parts.map((part, index) =>
        part.highlighted ? (
          <mark
            // biome-ignore lint/suspicious/noArrayIndexKey: 片段顺序即文本顺序，且没有稳定 id
            key={index}
            className="rounded-sm bg-amber-200/70 px-0.5 text-foreground dark:bg-amber-400/30"
          >
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </span>
  );
}
