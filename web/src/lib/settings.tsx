import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type SyncMode = 'follow' | 'pause' | 'free';
export type Theme = 'sakura' | 'serika' | 'nord' | 'paper';

export interface Settings {
  sync: SyncMode;
  lowercase: boolean;
  stripPunct: boolean;
  revealLyrics: boolean;
  fontSize: number; // rem
  theme: Theme;
  sources: { ytManual: boolean; lrclib: boolean; genius: boolean };
  geniusToken: string;
}

export const THEMES: Theme[] = ['sakura', 'serika', 'nord', 'paper'];

export const DEFAULT_SETTINGS: Settings = {
  sync: 'pause',
  lowercase: true,
  stripPunct: true,
  revealLyrics: true,
  fontSize: 1.6,
  theme: 'sakura',
  sources: { ytManual: true, lrclib: true, genius: true },
  geniusToken: '',
};

const KEY = 'musi-type:settings';

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: settings just won't persist */
  }
}

function load(): Settings {
  const saved = readJson<Partial<Record<keyof Settings, unknown>> & { sources?: Partial<Settings['sources']> }>(KEY, {});
  return {
    ...DEFAULT_SETTINGS,
    ...(saved as Partial<Settings>),
    sync: saved.sync === 'free' || saved.sync === 'follow' ? saved.sync : 'pause',
    theme: THEMES.includes(saved.theme as Theme) ? (saved.theme as Theme) : 'sakura',
    sources: { ...DEFAULT_SETTINGS.sources, ...saved.sources },
  };
}

interface Ctx {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load);
  const update = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), []);

  useEffect(() => {
    writeJson(KEY, settings);
    document.documentElement.dataset.theme = settings.theme;
  }, [settings]);

  const value = useMemo(() => ({ settings, update }), [settings, update]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings outside SettingsProvider');
  return ctx;
}
