/**
 * 与平台无关的纯路径工具（POSIX 风格，用于内存 FS 与包内路径）。
 * 桌面端真实路径由 `IAppPaths.join` 处理（Windows 反斜杠），二者不要混用。
 */

export function joinPath(...parts: string[]): string {
  const joined = parts
    .filter((p) => p.length > 0)
    .join('/')
    .replace(/\/{2,}/g, '/');
  return joined.length > 1 && joined.endsWith('/') ? joined.slice(0, -1) : joined;
}

export function basenamePath(path: string): string {
  const clean = path.replace(/\/+$/, '');
  const idx = clean.lastIndexOf('/');
  return idx === -1 ? clean : clean.slice(idx + 1);
}

export function dirnamePath(path: string): string {
  const clean = path.replace(/\/+$/, '');
  const idx = clean.lastIndexOf('/');
  if (idx <= 0) return '/';
  return clean.slice(0, idx);
}

export function extnamePath(path: string): string {
  const name = basenamePath(path);
  const idx = name.lastIndexOf('.');
  return idx <= 0 ? '' : name.slice(idx + 1).toLowerCase();
}

/** 把任意路径规整成以 `/` 开头的绝对路径，并解析 `.` / `..` */
export function normalizePath(path: string): string {
  const absolute = path.startsWith('/');
  const out: string[] = [];
  for (const segment of path.replace(/\\/g, '/').split('/')) {
    if (segment.length === 0 || segment === '.') continue;
    if (segment === '..') {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return `${absolute ? '/' : ''}${out.join('/')}`;
}
