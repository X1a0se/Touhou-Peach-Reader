import { useState } from 'react';
import { Link } from 'react-router';
import { TagLinks } from '../components/TagLinks.js';
import { useFavorites } from '../favorites/FavoritesProvider.js';

type Tab = 'articles' | 'series';

const TABS: { key: Tab; label: string }[] = [
  { key: 'articles', label: '文章' },
  { key: 'series', label: '系列' },
];

export function FavoritesPage() {
  const { entries, remove } = useFavorites();
  const [tab, setTab] = useState<Tab>('articles');
  const list = tab === 'articles' ? entries.articles : entries.series;

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-medium">收藏夹</h2>
        <p className="text-xs text-muted-foreground">收藏保存在 user/{'{databaseId}'}.json，不随数据库导出。</p>
      </header>

      <div className="flex gap-1 border-b border-border">
        {TABS.map((item) => {
          const count = item.key === 'articles' ? entries.articles.length : entries.series.length;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                tab === item.key
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {item.label}
              {count > 0 ? <span className="ml-1 text-xs text-muted-foreground">{count}</span> : null}
            </button>
          );
        })}
      </div>

      {list.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {tab === 'articles' ? '还没有收藏的文章。' : '还没有收藏的系列。'}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {list.map((entry) => (
            <li key={`${entry.kind}:${entry.id}`} className="flex items-start gap-3 p-4">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center gap-2">
                  {entry.stale ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">已失效</span>
                  ) : null}
                  {entry.to ? (
                    <Link to={entry.to} className="truncate text-sm font-medium hover:underline">
                      {entry.title}
                    </Link>
                  ) : (
                    <span className="truncate text-sm font-medium text-muted-foreground">{entry.title}</span>
                  )}
                </div>
                {entry.stale ? (
                  <p className="text-xs text-muted-foreground">目标已从当前数据库中删除，可移出收藏夹。</p>
                ) : entry.summary ? (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{entry.summary}</p>
                ) : null}
                <TagLinks tags={entry.tags} limit={4} />
              </div>
              <button
                type="button"
                onClick={() => {
                  void remove(entry.kind, entry.id);
                }}
                className="ml-auto shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                取消收藏
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
