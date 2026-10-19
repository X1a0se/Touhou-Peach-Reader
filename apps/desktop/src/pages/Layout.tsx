import { VersionBadge, cn } from '@tpr/ui';
import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router';
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

  return (
    <main className="mx-auto flex min-h-full max-w-5xl flex-col gap-8 px-8 py-14">
      <header className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{services.app.getName()}</h1>
          <VersionBadge version={services.app.getVersion()} />
          <span className="ml-auto font-mono text-xs text-muted-foreground">{services.platform.kind}</span>
        </div>
        <p className="text-sm text-muted-foreground">东方同人阅读器 · 阅读器与数据库分离</p>
        <nav className="flex flex-wrap gap-1 border-b border-border">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <Suspense fallback={<p className="text-sm text-muted-foreground">载入中…</p>}>
        <Outlet />
      </Suspense>

      <footer className="mt-auto text-xs text-muted-foreground">
        数据目录由 <span className="font-mono">$APPDATA/com.touhou.peachreader</span> 决定；正文按需读取。
      </footer>
    </main>
  );
}
