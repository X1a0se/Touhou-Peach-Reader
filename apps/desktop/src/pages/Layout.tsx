import { VersionBadge, cn } from '@tpr/ui';
import { Suspense } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { BackButton } from '../components/BackButton.js';
import { WallpaperLayer } from '../components/WallpaperLayer.js';
import { useServices } from '../context.js';

const NAV = [
  { to: '/', label: '首页' },
  { to: '/articles', label: '文章库' },
  { to: '/search', label: '搜索' },
  { to: '/featured/short', label: '精选短文' },
  { to: '/featured/series', label: '精选系列' },
  { to: '/favorites', label: '收藏' },
  { to: '/editor', label: '编辑器' },
  { to: '/merge', label: '合并' },
  { to: '/import', label: '导入' },
  { to: '/credits', label: '鸣谢' },
  { to: '/settings', label: '设置' },
];

export function Layout() {
  const services = useServices();
  const location = useLocation();
  const slot = location.pathname.startsWith('/article/') ? 'article' : 'home';

  return (
    <div className="relative min-h-full">
      <WallpaperLayer slot={slot} />

      <header className="sticky top-0 z-30 border-b border-border bg-background/75 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-col gap-2.5 px-6 pt-3 pb-2">
          <div className="flex items-center gap-3">
            {location.pathname === '/' ? null : <BackButton />}
            <span
              aria-hidden
              className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-accent-soft text-lg shadow-sm"
            >
              🍑
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-lg leading-tight font-semibold tracking-tight">
                {services.app.getName()}
              </h1>
              <p className="text-[0.7rem] text-muted-foreground">
                桃文阅读器 · 阅读器与数据库分离
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <VersionBadge version={services.app.getVersion()} />
              <span className="hidden rounded-full border border-border px-2 py-0.5 font-mono text-[0.65rem] text-muted-foreground sm:inline">
                {services.platform.kind}
              </span>
            </div>
          </div>

          <nav aria-label="主导航" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'shrink-0 rounded-full px-3 py-1.5 text-sm whitespace-nowrap transition-colors',
                    isActive
                      ? 'bg-accent-soft font-medium text-foreground ring-1 ring-[var(--ring)]'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex max-w-6xl flex-col gap-8 px-6 py-8">
        <Suspense fallback={<p className="text-sm text-muted-foreground">载入中…</p>}>
          <Outlet />
        </Suspense>
      </main>

      <footer className="relative z-10 mx-auto max-w-6xl px-6 pb-8 text-xs text-muted-foreground">
        数据目录由 <span className="font-mono">$APPDATA/com.touhou.peachreader</span> 决定；正文按需读取。
      </footer>
    </div>
  );
}
