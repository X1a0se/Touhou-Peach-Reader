import { useState } from 'react';
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
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold">特别鸣谢</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          来自当前数据库的 `credits.json`，随库更新；数据库作者可以在这里署名。
        </p>
      </div>

      {error ? (
        <p className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {status !== 'ready' ? (
        <p className="text-sm text-muted-foreground">还没有打开数据库，先导入一个 `.tpr` 包吧。</p>
      ) : credits.length === 0 ? (
        <p className="text-sm text-muted-foreground">这个数据库没有填写鸣谢。</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {credits.map((credit, index) => (
            <li key={`${credit.name}-${index}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-4">
              <span className="font-medium">{credit.name}</span>
              {credit.role ? <span className="text-sm text-muted-foreground">{credit.role}</span> : null}
              {credit.note ? <span className="text-sm text-muted-foreground">{credit.note}</span> : null}
              {credit.link ? (
                <button
                  type="button"
                  className="ml-auto text-sm underline"
                  onClick={() => void open(credit.link ?? '')}
                >
                  链接
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
