import type { GitHubError } from '@tpr/core';
import { Button, DropZone, Panel, ProgressBar, SectionHeading } from '@tpr/ui';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useServices } from '../context.js';
import { useLibraryContext } from '../library/LibraryProvider.js';
import { pickTprFile, readFileBytes } from '../platform/files.js';
import { isTauri } from '../platform/index.js';
import { useSettingsContext } from '../settings/SettingsProvider.js';
const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** 下载阶段的进度：字节数 + 起始时间，用来算百分比与剩余时间。 */
interface DownloadState {
  received: number;
  total?: number;
  startedAt: number;
}

/** 用"已下载字节 / 已用时间"外推剩余时间；总大小未知时返回 null（只显示不确定进度）。 */
function downloadEta(state: DownloadState): number | null {
  const { received, total, startedAt } = state;
  if (total === undefined || total <= 0 || received <= 0) return null;
  const elapsed = Date.now() - startedAt;
  if (elapsed < 300) return null;
  const rate = received / elapsed;
  if (rate <= 0) return null;
  return Math.max(0, (total - received) / rate);
}

function isGitHubError(error: unknown): error is GitHubError {
  return error instanceof Error && error.name === 'GitHubError';
}

export function ImportPage() {
  const services = useServices();
  const library = useLibraryContext();
  const { settings, ready } = useSettingsContext();
  const [source, setSource] = useState(settings.defaultSource);
  const [downloadState, setDownloadState] = useState<DownloadState | null>(null);
  // 浏览器预览没有原生文件对话框：隐藏的 <input type="file"> 让 pnpm dev:web 也能选包导入。
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [githubError, setGithubError] = useState<string | null>(null);

  // 设置在 Provider 里异步载入：读到默认源且用户还没输入时预填
  useEffect(() => {
    if (!ready) return;
    setSource((current) => (current.length === 0 ? settings.defaultSource : current));
  }, [ready, settings.defaultSource]);

  const pick = async (): Promise<void> => {
    const path = await pickTprFile();
    if (path) await library.importPath(path);
  };

  const download = async (): Promise<void> => {
    if (source.trim().length === 0) {
      setGithubError('先填一个 GitHub 仓库或 release 地址');
      return;
    }
    setGithubError(null);
    setDownloadState({ received: 0, startedAt: Date.now() });
    try {
      const result = await services.github.download(source.trim(), {
        onProgress: (received, total) => {
          setDownloadState((prev) => ({
            received,
            ...(total !== undefined ? { total } : {}),
            startedAt: prev?.startedAt ?? Date.now(),
          }));
        },
      });
      setDownloadState(null);
      const outcome = await library.importBytes(result.bytes);
      if (!outcome.ok) setGithubError(outcome.error);
    } catch (cause) {
      setGithubError(isGitHubError(cause) ? `${cause.code}：${cause.message}` : describe(cause));
      setDownloadState(null);
    }
  };

  const downloadPercent =
    downloadState && downloadState.total && downloadState.total > 0
      ? downloadState.received / downloadState.total
      : undefined;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        eyebrow="入口"
        title="导入数据库"
        description="拖入 .tpr 包、从本地选择，或填 GitHub 仓库 / release 地址在线下载；导入时会自动合并同类别同名标签。"
      />

      {library.error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">
          {library.error}
        </p>
      ) : null}
      {library.message ? (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {library.message}{' '}
          <Link className="underline underline-offset-2" to="/">
            回首页
          </Link>
        </p>
      ) : null}

      <Panel className="py-4">
        <DropZone
          onPick={() => {
            if (isTauri()) void pick();
            else fileInput.current?.click();
          }}
          onFiles={(files) => {
            const first = files[0];
            if (!first) return;
            void readFileBytes(first).then((bytes) => library.importBytes(bytes));
          }}
          busy={library.busy}
          hint="一次拖入一个 .tpr 文件；导入会覆盖同 id 的本地库。"
        />
        <input
          ref={fileInput}
          type="file"
          accept=".tpr"
          aria-label="选择 .tpr 文件"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            void readFileBytes(file).then((bytes) => library.importBytes(bytes));
          }}
        />
      </Panel>

      {library.progress ? (
        <Panel>
          <ProgressBar
            value={library.progress.fraction}
            etaMs={library.progress.etaMs}
            label={library.progress.label}
            {...(library.progress.detail !== undefined
              ? { detail: library.progress.detail }
              : {})}
          />
        </Panel>
      ) : null}

      <Panel>
        <h3 className="text-sm font-medium">从 GitHub 下载</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          支持 `owner/repo`、仓库地址、release 地址或资产直链；默认已填好本项目的官方 Release。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            aria-label="GitHub 仓库或 release 地址"
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface/60 px-3 py-2 font-mono text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-[var(--ring)]"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="owner/repo 或 https://github.com/owner/repo/releases/latest"
          />
          <Button variant="primary" disabled={library.busy} onClick={() => void download()}>
            {library.busy ? '处理中…' : '下载并导入'}
          </Button>
        </div>
        {downloadState ? (
          <div className="mt-3">
            <ProgressBar
              size="sm"
              {...(downloadPercent !== undefined
                ? { value: downloadPercent, etaMs: downloadEta(downloadState) }
                : { indeterminate: true })}
              label={
                downloadState.total
                  ? `正在下载 ${(downloadState.received / 1024 / 1024).toFixed(1)} / ${(downloadState.total / 1024 / 1024).toFixed(1)} MB`
                  : `正在下载 ${(downloadState.received / 1024 / 1024).toFixed(1)} MB`
              }
            />
          </div>
        ) : null}
        {githubError ? (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{githubError}</p>
        ) : null}
      </Panel>
    </div>
  );
}
