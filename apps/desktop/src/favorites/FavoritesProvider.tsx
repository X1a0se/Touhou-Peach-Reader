import type { FavoriteEntry, FavoriteKind } from '@tpr/core';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useServices } from '../context.js';
import { useLibraryContext } from '../library/LibraryProvider.js';

interface FavoritesContextValue {
  entries: { articles: FavoriteEntry[]; series: FavoriteEntry[] };
  isFavorite(kind: FavoriteKind, id: string): boolean;
  toggle(kind: FavoriteKind, id: string): Promise<boolean>;
  remove(kind: FavoriteKind, id: string): Promise<void>;
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const services = useServices();
  const { snapshot } = useLibraryContext();
  const databaseId = snapshot?.manifest.databaseId ?? null;
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void services.favorites.load().then(() => {
      if (!cancelled) setVersion((value) => value + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [services, databaseId]);

  const toggle = useCallback(
    async (kind: FavoriteKind, id: string) => {
      await services.favorites.load();
      const next = await services.favorites.toggle(kind, id);
      setVersion((value) => value + 1);
      return next;
    },
    [services],
  );

  const remove = useCallback(
    async (kind: FavoriteKind, id: string) => {
      await services.favorites.remove(kind, id);
      setVersion((value) => value + 1);
    },
    [services],
  );

  const entries = useMemo(
    () => services.favorites.list(snapshot),
    // version 只用来在收藏/取消后触发重算
    [services, snapshot, version],
  );

  const value: FavoritesContextValue = {
    entries,
    isFavorite: (kind, id) => (kind === 'article' ? entries.articles : entries.series).some((entry) => entry.id === id),
    toggle,
    remove,
  };

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): FavoritesContextValue {
  const value = useContext(FavoritesContext);
  if (!value) throw new Error('useFavorites 必须在 <FavoritesProvider> 内使用');
  return value;
}
