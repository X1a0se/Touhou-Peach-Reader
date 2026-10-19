import type { Services } from '@tpr/core';
import { VersionBadge, cn } from '@tpr/ui';

interface Check {
  name: string;
  detail: string;
  ok: boolean;
}

export function App({ services }: { services: Services }) {
  const { platform } = services;
  const checks: Check[] = [
    { name: 'IFileSystem', detail: '读 / 写 / 列目录 / 重命名', ok: typeof platform.fs.readText === 'function' },
    { name: 'IZip', detail: '解包 / 打包（.tpr）', ok: typeof platform.zip.extractAll === 'function' },
    { name: 'INetwork', detail: 'JSON 与二进制下载', ok: typeof platform.network.download === 'function' },
    { name: 'IOpener', detail: '原出处外链', ok: typeof platform.opener.openExternal === 'function' },
    { name: 'IAssetUrls', detail: '本地图片转 URL', ok: typeof platform.assets.toUrl === 'function' },
  ];

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col justify-center gap-8 px-8 py-16">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{services.app.getName()}</h1>
          <VersionBadge version={services.app.getVersion()} />
        </div>
        <p className="text-sm text-muted-foreground">
          东方同人阅读器 · 阅读器与数据库分离 · 目标 1：骨架与跨平台分层
        </p>
      </header>

      <section className="rounded-lg border border-border p-5">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-sm font-medium">平台实现</h2>
          <span className="font-mono text-xs text-muted-foreground">{platform.kind}</span>
        </div>
        <ul className="flex flex-col gap-2">
          {checks.map((check) => (
            <li key={check.name} className="flex items-center gap-3 text-sm">
              <span
                className={cn(
                  'inline-block size-2 rounded-full',
                  check.ok ? 'bg-emerald-500' : 'bg-red-500',
                )}
              />
              <span className="font-mono text-xs">{check.name}</span>
              <span className="text-muted-foreground">{check.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="text-xs text-muted-foreground">
        版本来自 <span className="font-mono">@tpr/core.getVersion()</span>；窗口标题由{' '}
        <span className="font-mono">tauri.conf.json</span> 决定。
      </footer>
    </main>
  );
}
