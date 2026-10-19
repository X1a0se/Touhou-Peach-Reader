import { Fragment, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface MarkdownProps {
  source: string;
  /** 链接点击回调；不传则用 target=_blank 打开（浏览器） */
  onLink?: (url: string) => void;
  className?: string;
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;

function inlineNodes(text: string, keyPrefix: string, onLink?: (url: string) => void): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const token = match[0];
    const key = `${keyPrefix}-i${index++}`;
    if (token.startsWith('`')) {
      nodes.push(
        <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**')) {
      nodes.push(
        <strong key={key} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('*')) {
      nodes.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    } else {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const label = linkMatch?.[1] ?? token;
      const url = linkMatch?.[2] ?? '';
      nodes.push(
        <a
          key={key}
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-rose-700 underline decoration-rose-300 underline-offset-2 hover:decoration-rose-600"
          onClick={(event) => {
            if (!onLink) return;
            event.preventDefault();
            onLink(url);
          }}
        >
          {label}
        </a>,
      );
    }
    last = start + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'rule' }
  | { kind: 'paragraph'; lines: string[] };

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (trimmed === '') {
      i += 1;
      continue;
    }

    const fence = /^(`{3,}|~{3,})(.*)$/.exec(trimmed);
    if (fence) {
      const marker = fence[1] ?? '```';
      const lang = (fence[2] ?? '').trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length) {
        const current = lines[i] ?? '';
        if (current.trim().startsWith(marker)) {
          i += 1;
          break;
        }
        body.push(current);
        i += 1;
      }
      blocks.push({ kind: 'code', lang, text: body.join('\n') });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]?.length ?? 1, text: heading[2] ?? '' });
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ kind: 'rule' });
      i += 1;
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length) {
        const current = (lines[i] ?? '').trim();
        if (!current.startsWith('>')) break;
        quote.push(current.replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ kind: 'quote', lines: quote });
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const items: string[] = [];
      while (i < lines.length) {
        const current = (lines[i] ?? '').trim();
        const match = ordered ? /^\d+[.)]\s+(.*)$/.exec(current) : /^[-*+]\s+(.*)$/.exec(current);
        if (!match) break;
        items.push(match[1] ?? '');
        i += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length) {
      const current = lines[i] ?? '';
      const currentTrimmed = current.trim();
      if (
        currentTrimmed === '' ||
        /^(#{1,6})\s+/.test(currentTrimmed) ||
        /^(`{3,}|~{3,})/.test(currentTrimmed) ||
        currentTrimmed.startsWith('>') ||
        /^[-*+]\s+/.test(currentTrimmed) ||
        /^\d+[.)]\s+/.test(currentTrimmed) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(currentTrimmed)
      ) {
        break;
      }
      paragraph.push(currentTrimmed);
      i += 1;
    }
    blocks.push({ kind: 'paragraph', lines: paragraph });
  }

  return blocks;
}

const headingClass: Record<number, string> = {
  1: 'mt-6 text-2xl font-semibold text-foreground',
  2: 'mt-6 text-xl font-semibold text-foreground',
  3: 'mt-5 text-lg font-semibold text-foreground',
  4: 'mt-4 text-base font-semibold text-foreground',
  5: 'mt-4 text-sm font-semibold text-foreground',
  6: 'mt-4 text-sm font-semibold text-muted-foreground',
};

/** 受控的 Markdown 渲染：不注入 HTML，只认标题/段落/列表/引用/代码/规则线 + 四种行内标记。 */
export function Markdown({ source, onLink, className }: MarkdownProps) {
  const blocks = parseBlocks(source);

  return (
    <div className={cn('space-y-3 text-[15px] leading-7 text-foreground/90', className)}>
      {blocks.map((block, index) => {
        const key = `b${index}`;
        switch (block.kind) {
          case 'heading': {
            const Tag = `h${block.level}` as 'h1';
            return (
              <Tag key={key} className={cn(headingClass[block.level] ?? headingClass[6])}>
                {inlineNodes(block.text, key, onLink)}
              </Tag>
            );
          }
          case 'code':
            return (
              <pre
                key={key}
                className="overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 text-xs leading-6 text-foreground/90"
              >
                <code>{block.text}</code>
              </pre>
            );
          case 'quote':
            return (
              <blockquote key={key} className="border-l-2 border-accent pl-3 text-muted-foreground">
                {inlineNodes(block.lines.join('\n'), key, onLink)}
              </blockquote>
            );
          case 'list': {
            const List = block.ordered ? 'ol' : 'ul';
            return (
              <List key={key} className={cn('ml-5 space-y-1', block.ordered ? 'list-decimal' : 'list-disc')}>
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>{inlineNodes(item, `${key}-${itemIndex}`, onLink)}</li>
                ))}
              </List>
            );
          }
          case 'rule':
            return <hr key={key} className="my-5 border-border" />;
          case 'paragraph':
          default:
            return (
              <p key={key}>
                {block.lines.map((line, lineIndex) => (
                  <Fragment key={`${key}-${lineIndex}`}>
                    {lineIndex > 0 ? <br /> : null}
                    {inlineNodes(line, `${key}-${lineIndex}`, onLink)}
                  </Fragment>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}
