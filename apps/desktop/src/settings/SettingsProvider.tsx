import type { AppSettings, Services, ThemeMode } from '@tpr/core';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { useServices } from '../context.js';

export interface SettingsState {
  settings: AppSettings;
  ready: boolean;
  save(patch: Partial<AppSettings>): Promise<void>;
}

const DEFAULT: AppSettings = {
  theme: 'system',
  language: 'zh-CN',
  defaultSource: '',
  mirrorPrefix: '',
};

const SettingsContext = createContext<SettingsState | null>(null);

function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** 把主题落到 <html class="dark">（design §13.1：light / dark / system 三档） */
export function resolveDark(theme: ThemeMode): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return prefersDark();
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const services: Services = useServices();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void services.settings.load().then((loaded) => {
      if (cancelled) return;
      setSettings(loaded);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [services]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (): void => {
      document.documentElement.classList.toggle('dark', resolveDark(settings.theme));
    };
    apply();
    if (settings.theme !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings.theme]);

  const save = async (patch: Partial<AppSettings>): Promise<void> => {
    const next = await services.settings.save(patch);
    setSettings(next);
  };

  return (
    <SettingsContext.Provider value={{ settings, ready, save }}>{children}</SettingsContext.Provider>
  );
}

export function useSettingsContext(): SettingsState {
  const state = useContext(SettingsContext);
  if (!state) throw new Error('useSettingsContext 必须在 <SettingsProvider> 内使用');
  return state;
}
