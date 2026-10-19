import type { GitHubError } from '@tpr/core';
import { DropZone } from '@tpr/ui';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useServices } from '../context.js';
import { useLibraryContext } from '../library/LibraryProvider.js';
import { useNativeDrop } from '../library/useLibrary.js';
import { pickTprFile, readFileBytes } from '../platform/files.js';
import { useSettingsContext } from '../settings/SettingsProvider.js';

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function isGitHubError(error: unknown): error is GitHubError {
  return error instanceof Error && error.name === 'GitHubError';
}

export function ImportPage() {
  const services = useServices();
  const library = useLibraryContext();
  const { settings, ready } = useSettingsContext();
  const [source, setSource] = useState(settings.defaultSource);
  const [progress, setProgress] = useState<string | null>(null);
  const [githubError, setGithubError] = useState<string | null>(null);

  // 设置在 Provider 里异步载入：读到默认源且用户还没输入时预填
  useEffect(() => {
    if (!ready) return;
    setSource((current) => (current.length === 0 ? settings.defaultSource : current));
  }, [ready, settings.defaultSource]);

  const handlePaths = useCallback(
    (paths: string[]) => {
      const first = paths[0];
      if (first) void library.importPath(first);
    },
    [library],
  );
  useNativeDrop(handlePaths);

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
    setProgress('正在解析 release…');
    try {
      const result = await services.github.download(source.trim(), {
        onProgress: (received, total) => {
          const mb = (received / 1024 / 1024).toFixed(1);
          setProgress(total ? `正在下载 ${mb} / ${(total / 1024 / 1024).toFixed(1)} MB…` : `正在下载 ${mb} MB…`);
        },
      });
      setProgress(`已下载 ${result.fileName}（${result.tag}），正在导入…`);
      await library.importBytes(result.bytes);
      setProgress(null);
    } catch (cause) {
      setGithubError(isGitHubError(cause) ? `${cause.code}：${cause.message}` : describe(cause));
      setProgress(null);
    }
  };

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold">导入数据库</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          拖入 `.tpr` 包、从本地选择，或填 GitHub 仓库 / release 地址在线下载。
        </p>
      </div>

      {library.error ? (
        <p className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {library.error}
        </p>
      ) : null}
      {library.message ? (
        <p className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
          {library.message}{' '}
          <Link className="underline" to="/">
            回首页
          </Link>
        </p>
      ) : null}

      <DropZone
        onPick={() => void pick()}
        onFiles={(files) => {
          const first = files[0];
          if (!first) return;
          void readFileBytes(first).then((bytes) => library.importBytes(bytes));
        }}
        busy={library.busy}
        hint="一次拖入一个 .tpr 文件；导入会覆盖同 id 的本地库。"
      />

      <div className="rounded-lg border border-border p-5">
        <h3 className="text-sm font-medium">从 GitHub 下载</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          支持 `owner/repo`、仓库地址、release 地址或资产直链；下载走设置里的镜像前缀（如果填了）。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            aria-label="GitHub 仓库或 release 地址"
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="example/tpr-db 或 https://github.com/example/tpr-db/releases/tag/v1.4.0"
          />
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            disabled={library.busy}
            onClick={() => void download()}
          >
            {library.busy ? '处理中…' : '下载并导入'}
          </button>
        </div>
        {progress ? <p className="mt-2 text-xs text-muted-foreground">{progress}</p> : null}
        {githubError ? (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{githubError}</p>
        ) : null}
      </div>
    </section>
  );
}
