import { createContext, type ReactNode, useContext } from 'react';
import { useServices } from '../context.js';
import { useLibrary, type LibraryState } from './useLibrary.js';

const LibraryContext = createContext<LibraryState | null>(null);

/** 全应用共用一份库状态：只在这里 restore 一次，页面消费结果。 */
export function LibraryProvider({ children }: { children: ReactNode }) {
  const services = useServices();
  const state = useLibrary(services);
  return <LibraryContext.Provider value={state}>{children}</LibraryContext.Provider>;
}

export function useLibraryContext(): LibraryState {
  const state = useContext(LibraryContext);
  if (!state) throw new Error('useLibraryContext 必须在 <LibraryProvider> 内使用');
  return state;
}
