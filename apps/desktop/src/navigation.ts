/**
 * 判断当前 history 是否有应用内上一页。
 *
 * React Router 8 会把 { usr, key, idx } 写进 history.state；idx > 0 才表示有上一页。
 * 从 #/settings、#/article/... 直接启动时 idx 为 0，此时「返回」应回首页而不是退出应用。
 */
export function canGoBack(state: unknown): boolean {
  if (typeof state !== 'object' || state === null) return false;
  const idx = (state as { idx?: unknown }).idx;
  return typeof idx === 'number' && Number.isInteger(idx) && idx > 0;
}
