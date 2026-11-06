import { Button, EmptyState, Panel, R18Badge, SectionHeading } from '@tpr/ui';
import { Link } from 'react-router';
import { TagLinks } from '../components/TagLinks.js';
import { useReading } from '../reading/ReadingProvider.js';

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
  const { history, removeHistory, clearHistory } = useReading();

  return (
    <div className="flex flex-col gap-5">
      <SectionHeading
        eyebrow="阅读"
        title="阅读足迹"
        description="阅读位置与系列进度只保存在本机，不随数据库导出。"
      />

      <div className="flex flex-wrap items-center gap-2">
        {history.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-muted-foreground"
            onClick={() => {
              if (window.confirm('确定清空全部阅读足迹？阅读位置与系列进度会保留。')) {
                void clearHistory();
              }
            }}
          >
            清空足迹
          </Button>
        ) : null}
      </div>

      {history.length === 0 ? (
        <EmptyState
          icon="👣"
          title="还没有阅读足迹"
          description="打开任意文章后，这里会自动记录阅读时间与读到哪儿。"
          action={
            <Link to="/articles">
              <Button size="sm">去文章库</Button>
            </Link>
          }
        />
      ) : (
        <Panel className="divide-y divide-border p-0">
          {history.map((entry) => (
            <div key={entry.articleId} className="flex items-start gap-3 p-4">
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
          ))}
        </Panel>
      )}
    </div>
  );
}
