import { Button, EmptyState, Panel, SectionHeading } from '@tpr/ui';
import { useState } from 'react';
import { Link } from 'react-router';
import { useServices } from '../context.js';
import { useLibraryContext } from '../library/LibraryProvider.js';

export function CreditsPage() {
  const services = useServices();
  const { snapshot, status } = useLibraryContext();
  const [error, setError] = useState<string | null>(null);
  const credits = snapshot?.credits ?? [];

  const open = async (link: string): Promise<void> => {
    setError(null);
    try {
      await services.platform.opener.openExternal(link);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        eyebrow="致谢"
        title="特别鸣谢"
        description="来自当前数据库的 credits.json，随库更新；数据库作者可以在这里署名。"
      />

      {error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {status !== 'ready' ? (
        <EmptyState
          icon="🌸"
          title="还没有打开数据库"
          description="先导入一个 .tpr 包，这里会显示它的鸣谢名单。"
          action={
            <Link to="/import">
              <Button size="sm">去导入</Button>
            </Link>
          }
        />
      ) : credits.length === 0 ? (
        <EmptyState icon="🍃" title="这个数据库没有填写鸣谢" description="编辑器的「鸣谢」页签可以补上。" />
      ) : (
        <Panel className="divide-y divide-border p-0">
          {credits.map((credit, index) => (
            <div
              key={`${credit.name}-${index}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-4"
            >
              <span className="text-sm font-medium">{credit.name}</span>
              {credit.role ? (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[0.7rem] text-accent">
                  {credit.role}
                </span>
              ) : null}
              {credit.note ? <span className="text-sm text-muted-foreground">{credit.note}</span> : null}
              {credit.link ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => void open(credit.link ?? '')}
                >
                  打开链接 ↗
                </Button>
              ) : null}
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}
