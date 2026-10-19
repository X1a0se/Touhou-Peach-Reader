export type ClassValue = string | number | false | null | undefined;

/**
 * 极简 class 合并。等 shadcn 落地后替换为 clsx + tailwind-merge（Goal 4/5），
 * 现在不引依赖，避免"还没有组件就先装两吨包"。
 */
export function cn(...values: ClassValue[]): string {
  return values.filter((v) => v !== null && v !== undefined && v !== false && v !== '').join(' ');
}
