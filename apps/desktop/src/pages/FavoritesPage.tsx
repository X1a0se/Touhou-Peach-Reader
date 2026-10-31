import { Button, EmptyState, Panel, R18Badge, SectionHeading, cn } from '@tpr/ui';
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
    <div className="flex flex-col gap-5">
      <SectionHeading
        eyebrow="书架"
        title="收藏夹"
        description="收藏保存在 user/{databaseId}.json，不随数据库导出。"
      />

      <div className="flex gap-2">
        {TABS.map((item) => {
          const count = item.key === 'articles' ? entries.articles.length : entries.series.length;
          return (
            <Button
              key={item.key}
              size="sm"
              variant={tab === item.key ? 'primary' : 'secondary'}
              aria-pressed={tab === item.key}
              onClick={() => setTab(item.key)}
            >
              {item.label}
              {count > 0 ? <span className={cn('ml-1 text-xs', tab === item.key ? '' : 'text-muted-foreground')}>{count}</span> : null}
            </Button>
          );
        })}
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon="☆"
          title={tab === 'articles' ? '还没有收藏的文章' : '还没有收藏的系列'}
          description="在文章或系列页点右上角的「收藏」，就会出现在这里。"
          action={
            <Link to="/articles">
              <Button size="sm">去逛逛</Button>
            </Link>
          }
        />
      ) : (
        <Panel className="divide-y divide-border p-0">
          {list.map((entry) => (
            <div key={`${entry.kind}:${entry.id}`} className="flex items-start gap-3 p-4">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center gap-2">
                  {entry.stale ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[0.65rem] text-muted-foreground">
                      已失效
                    </span>
                  ) : null}
                  {entry.r18 ? <R18Badge /> : null}
                  {entry.to ? (
                    <Link to={entry.to} className="truncate text-sm font-medium hover:text-accent">
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
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto shrink-0"
                onClick={() => {
                  void remove(entry.kind, entry.id);
                }}
              >
                取消收藏
              </Button>
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}
