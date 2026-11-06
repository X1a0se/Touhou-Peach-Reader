import type {
  AppSettings,
  ReadingFontFamily,
  ReadingTypographySettings,
  Services,
  SettingsPatch,
  ThemeMode,
} from '@tpr/core';
import { DEFAULT_SETTINGS } from '@tpr/core';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { useServices } from '../context.js';

export interface SettingsState {
  settings: AppSettings;
  ready: boolean;
  save(patch: SettingsPatch): Promise<void>;
}

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

/**
 * 外观落到 <html>：`class="dark"` 控制明暗，`data-palette` 控制配色（design §13.1）。
 * 两者都由 CSS token 消费，React 树不需要重渲染。
 */
function applyAppearance(theme: ThemeMode, palette: string): void {
  const root = document.documentElement;
  root.classList.toggle('dark', resolveDark(theme));
  root.dataset['palette'] = palette;
  root.style.colorScheme = resolveDark(theme) ? 'dark' : 'light';
}

export const READING_FONT_STACKS: Record<ReadingFontFamily, string> = {
  system: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
  serif: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, serif',
  sans: '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif',
  kai: 'KaiTi, STKaiti, "Noto Serif SC", serif',
};

/**
 * 阅读排版落到 <html> 的 CSS 变量，由 `.reading` 消费。
 * 存 px 而不是 rem：设置页的滑杆与预览在同一坐标系里。
 */
function applyReadingTypography(reading: ReadingTypographySettings): void {
  const root = document.documentElement;
  root.style.setProperty('--reading-font-family', READING_FONT_STACKS[reading.fontFamily]);
  root.style.setProperty('--reading-font-size', `${reading.fontSize}px`);
  root.style.setProperty('--reading-line-height', String(reading.lineHeight));
  root.style.setProperty('--reading-paragraph-gap', `${reading.paragraphSpacing}em`);
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const services: Services = useServices();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
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
    const apply = (): void => applyAppearance(settings.theme, settings.palette);
    apply();
    if (settings.theme !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings.theme, settings.palette]);

  useEffect(() => {
    applyReadingTypography(settings.reading);
  }, [
    settings.reading.fontFamily,
    settings.reading.fontSize,
    settings.reading.lineHeight,
    settings.reading.paragraphSpacing,
  ]);

  const save = async (patch: SettingsPatch): Promise<void> => {
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
