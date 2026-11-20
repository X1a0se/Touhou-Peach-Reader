import { type RefObject, useCallback, useEffect, useState } from 'react';
import { jumpScrollBehavior, needsJumpToBottom } from '../scroll.js';

interface ScrollToBottomButtonProps {
  /** 表单底部的操作行：它还被挡在视口下方时按钮才出现。 */
  targetRef: RefObject<HTMLElement | null>;
}

/**
 * 「直达底部」浮动按钮。
 *
 * 只在目标行还没整个进入视口时出现。重算挂在三处：滚动、窗口尺寸变化、页面高度变化
 * （正文异步加载完、导入 .txt、选择器增删芯片都会改高度，这时并没有滚动事件）。
 * 重算用一次 rAF 合并，滚动再密也只算一帧。
 *
 * 没有 DOM（SSR / renderToStaticMarkup）时什么都不渲染。
 */
export function ScrollToBottomButton({ targetRef }: ScrollToBottomButtonProps) {
  const [visible, setVisible] = useState(false);

  const sync = useCallback(() => {
    const target = targetRef.current;
    if (!target) {
      setVisible(false);
      return;
    }
    setVisible(needsJumpToBottom(target.getBoundingClientRect().bottom, window.innerHeight));
  }, [targetRef]);

  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        sync();
      });
    };
    sync();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule());
    observer?.observe(document.body);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [sync]);

  if (!visible) return null;

  const jump = () => {
    const reduceMotion =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false;
    targetRef.current?.scrollIntoView({ block: 'end', behavior: jumpScrollBehavior(reduceMotion) });
    // 平滑滚动要几百毫秒，先撤掉按钮，别让它停在半路
    setVisible(false);
  };

  return (
    <button
      type="button"
      onClick={jump}
      aria-label="直达底部"
      title="直达底部"
      className="fixed right-5 bottom-5 z-40 inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-surface/90 px-4 text-sm text-muted-foreground shadow-lg backdrop-blur transition-colors hover:bg-surface-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] sm:right-8 sm:bottom-8"
    >
      <span className="hidden sm:inline">直达底部</span>
      <span aria-hidden className="text-base leading-none">
        ↓
      </span>
    </button>
  );
}
