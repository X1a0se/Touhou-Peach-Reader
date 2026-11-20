/**
 * 「直达底部」的显示判定与滚动方式。
 *
 * 纯函数：只算数、不碰 window，便于在 Node 测试里验证（同 navigation.ts / reading/progress.ts）。
 */

/**
 * 底部操作行是否还藏在视口下方（需要「直达底部」）。
 *
 * 拿操作行的 `getBoundingClientRect().bottom` 比视口高度：只要它整个落在视口里就不需要按钮。
 * 之所以不看 top，是因为 `scrollIntoView({ block: 'end' })` 是把元素**底边**贴到视口底边——
 * 按 top 判断会在跳完之后（top 比视口底高出一个按钮行的高度）又把按钮判出来，点了不消失。
 * tolerance 吃掉亚像素舍入，避免贴边时按钮反复闪。
 */
export function needsJumpToBottom(
  targetBottom: number,
  viewportHeight: number,
  tolerance = 4,
): boolean {
  return targetBottom > viewportHeight + tolerance;
}

/** 系统开了「减少动态效果」时瞬时到位，否则平滑滚动。 */
export function jumpScrollBehavior(reduceMotion: boolean): ScrollBehavior {
  return reduceMotion ? 'auto' : 'smooth';
}
