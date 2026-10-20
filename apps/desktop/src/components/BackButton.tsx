import { useNavigate } from 'react-router';
import { canGoBack } from '../navigation.js';

/** 全局「返回上一页」：有应用内历史就后退，否则回首页。 */
export function BackButton() {
  const navigate = useNavigate();

  const goBack = (): void => {
    if (canGoBack(window.history.state)) navigate(-1);
    else navigate('/');
  };

  return (
    <button
      type="button"
      onClick={goBack}
      aria-label="返回上一页"
      title="返回上一页"
      className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-border bg-surface px-3 text-sm text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      <span aria-hidden className="text-base leading-none">
        ←
      </span>
      <span className="hidden sm:inline">返回</span>
    </button>
  );
}
