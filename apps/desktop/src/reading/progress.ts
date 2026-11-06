/**
 * 正文阅读进度计算。
 *
 * 进度只覆盖文章正文容器，不把标题信息、插图、页脚算进去。
 * 纯函数便于在 Node 测试里验证，不依赖 window/DOM。
 */

export function readingProgress(
  scrollY: number,
  contentTop: number,
  contentHeight: number,
  viewportHeight: number,
): number {
  const max = Math.max(0, contentHeight - viewportHeight);
  if (max === 0) return 1;
  return Math.min(1, Math.max(0, (scrollY - contentTop) / max));
}

export function scrollTargetForProgress(
  progress: number,
  contentTop: number,
  contentHeight: number,
  viewportHeight: number,
): number {
  const max = Math.max(0, contentHeight - viewportHeight);
  return contentTop + Math.min(1, Math.max(0, progress)) * max;
}
