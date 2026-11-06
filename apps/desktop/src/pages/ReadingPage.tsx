import { Button, EmptyState, Panel, R18Badge, SectionHeading, cn } from '@tpr/ui';
import { useState } from 'react';
import { Link } from 'react-router';
import { TagLinks } from '../components/TagLinks.js';
import { useReading } from '../reading/ReadingProvider.js';

type Tab = 'history' | 'bookmarks';

const TABS: { key: Tab; label: string }[] = [
  { key: 'history', label: '阅读足迹' },
  { key: 'bookmarks', label: '书签' },
];

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 16).replace('T', ' ');
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ProgressBar({ progress }: { progress: number }) {
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div className="flex items-center gap-2 text-[0.65rem] text-muted-foreground">
      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
      <span>{percent}%</span>
    </div>
  );
}

export function ReadingPage() {
  const { history, bookmarks, removeHistory, clearHistory, removeBookmark } = useReading();
  const [tab, setTab] = useState<Tab>('history');

  const list = tab === 'history' ? history : bookmarks;

  return (
    <div className="flex flex-col gap-5">
      <SectionHeading
        eyebrow="阅读"
        title="阅读足迹"
        description="阅读位置、书签与系列进度只保存在本机，不随数据库导出。"
      />

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((item) => {
          const count = item.key === 'history' ? history.length : bookmarks.length;
          return (
            <Button
              key={item.key}
              size="sm"
              variant={tab === item.key ? 'primary' : 'secondary'}
              aria-pressed={tab === item.key}
              onClick={() => setTab(item.key)}
            >
              {item.label}
              {count > 0 ? (
                <span className={cn('ml-1 text-xs', tab === item.key ? '' : 'text-muted-foreground')}>{count}</span>
              ) : null}
            </Button>
          );
        })}
        {tab === 'history' && history.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-muted-foreground"
            onClick={() => {
              if (window.confirm('确定清空全部阅读足迹？书签与阅读位置会保留。')) {
                void clearHistory();
              }
            }}
          >
            清空足迹
          </Button>
        ) : null}
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={tab === 'history' ? '👣' : '🔖'}
          title={tab === 'history' ? '还没有阅读足迹' : '还没有书签'}
          description={
            tab === 'history'
              ? '打开任意文章后，这里会自动记录阅读时间与读到哪儿。'
              : '在文章页选中想记住的文字（或直接滚动到某处）后点「加书签」，即可标记并快速跳回。'
          }
          action={
            <Link to="/articles">
              <Button size="sm">去文章库</Button>
            </Link>
          }
        />
      ) : (
        <Panel className="divide-y divide-border p-0">
          {tab === 'history'
            ? history.map((entry) => (
                <div key={entry.articleId} className="flex items-start gap-3 p-4">
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {entry.r18 ? <R18Badge /> : null}
                      {entry.bookmarked ? (
                        <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[0.65rem] text-sky-700 dark:text-sky-300">
                          书签
                        </span>
                      ) : null}
                      {entry.to ? (
                        <Link to={entry.to} className="truncate text-sm font-medium hover:text-accent">
                          {entry.title}
                        </Link>
                      ) : (
                        <span className="truncate text-sm font-medium text-muted-foreground">{entry.title}</span>
                      )}
                      {entry.series ? (
                        <Link
                          to={`/series/${entry.series.id}`}
                          className="shrink-0 text-xs text-muted-foreground hover:text-accent"
                        >
                          《{entry.series.title}》
                          {entry.series.index === null ? '' : ` 第 ${entry.series.index} 篇`}
                        </Link>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>上次阅读：{formatTime(entry.lastReadAt)}</span>
                      <ProgressBar progress={entry.progress} />
                    </div>
                    <TagLinks tags={entry.tags} limit={4} />
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => {
                      void removeHistory(entry.articleId);
                    }}
                  >
                    移出足迹
                  </Button>
                </div>
              ))
            : bookmarks.map((entry) => (
                <div key={entry.bookmarkId} className="flex items-start gap-3 p-4">
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {entry.r18 ? <R18Badge /> : null}
                      {entry.to ? (
                        <Link to={entry.to} className="truncate text-sm font-medium hover:text-accent">
                          {entry.title}
                        </Link>
                      ) : (
                        <span className="truncate text-sm font-medium text-muted-foreground">{entry.title}</span>
                      )}
                      {entry.series ? (
                        <Link
                          to={`/series/${entry.series.id}`}
                          className="shrink-0 text-xs text-muted-foreground hover:text-accent"
                        >
                          《{entry.series.title}》
                          {entry.series.index === null ? '' : ` 第 ${entry.series.index} 篇`}
                        </Link>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      🔖 {entry.label || `读到 ${Math.round(entry.progress * 100)}%`}
                    </p>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>书签位置：{formatTime(entry.bookmarkAt)}</span>
                      <ProgressBar progress={entry.progress} />
                    </div>
                    <TagLinks tags={entry.tags} limit={4} />
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => {
                      void removeBookmark(entry.articleId, entry.bookmarkId);
                    }}
                  >
                    删除书签
                  </Button>
                </div>
              ))}
        </Panel>
      )}
    </div>
  );
}
