import type { FavoriteKind } from '@tpr/core';
import { useFavorites } from '../favorites/FavoritesProvider.js';

export function FavoriteButton({ kind, id, className }: { kind: FavoriteKind; id: string; className?: string }) {
  const { isFavorite, toggle } = useFavorites();
  const active = isFavorite(kind, id);

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={active ? '取消收藏' : '收藏'}
      onClick={() => {
        void toggle(kind, id);
      }}
      className={
        className ??
        `inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors ${
          active
            ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200'
            : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
        }`
      }
    >
      <span aria-hidden="true">{active ? '★' : '☆'}</span>
      {active ? '已收藏' : '收藏'}
    </button>
  );
}
