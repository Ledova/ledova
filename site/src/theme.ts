import { useSyncExternalStore } from 'react';

const THEME_STORAGE_KEY = 'ledova.theme';
const THEME_COLORS = { paper: '#f6f3ec', dark: '#151410' } as const;

type Theme = keyof typeof THEME_COLORS;

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'paper';
}

export function setTheme(theme: Theme) {
  if (theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {}
  listeners.forEach((listener) => listener());
}

export function useTheme() {
  return useSyncExternalStore(subscribe, currentTheme);
}
