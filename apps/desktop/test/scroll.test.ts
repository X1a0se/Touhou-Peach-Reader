/**
 * 「直达底部」的判定逻辑与空渲染。
 *
 * 本仓库桌面端测试只测纯逻辑（没有 jsdom / @testing-library）：这里验
 * `needsJumpToBottom` / `jumpScrollBehavior` 两个纯函数，再用 `react-dom/server`
 * 确认组件在没有 DOM 时不渲染、不抛错。
 */
import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ScrollToBottomButton } from '../src/components/ScrollToBottomButton.js';
import { jumpScrollBehavior, needsJumpToBottom } from '../src/scroll.js';

describe('直达底部的显示判定', () => {
  it('操作行在视口下方才需要按钮，已经整个看得见就不需要', () => {
    expect(needsJumpToBottom(2000, 800)).toBe(true);
    expect(needsJumpToBottom(300, 800)).toBe(false);
  });

  it('跳到底之后（底边贴住视口底边）按钮要收起来，不能自己又冒出来', () => {
    // scrollIntoView({ block: 'end' }) 的结果就是底边等于视口高度
    expect(needsJumpToBottom(800, 800)).toBe(false);
    expect(needsJumpToBottom(799, 800)).toBe(false);
  });

  it('亚像素误差与自定义容差', () => {
    expect(needsJumpToBottom(804, 800)).toBe(false);
    expect(needsJumpToBottom(805, 800)).toBe(true);
    expect(needsJumpToBottom(801, 800, 0)).toBe(true);
    expect(needsJumpToBottom(800, 800, 0)).toBe(false);
  });
});

describe('直达底部的滚动方式', () => {
  it('减少动态效果时瞬时到位，否则平滑滚动', () => {
    expect(jumpScrollBehavior(true)).toBe('auto');
    expect(jumpScrollBehavior(false)).toBe('smooth');
  });
});

describe('ScrollToBottomButton', () => {
  it('没有 DOM 时什么都不渲染（SSR 安全）', () => {
    const html = renderToStaticMarkup(
      createElement(ScrollToBottomButton, { targetRef: createRef<HTMLElement>() }),
    );
    expect(html).toBe('');
  });
});
