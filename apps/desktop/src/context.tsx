import type { Services } from '@tpr/core';
import { createContext, type ReactNode, useContext } from 'react';

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ value, children }: { value: Services; children: ReactNode }) {
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices 必须在 <ServicesProvider> 内使用');
  return services;
}
