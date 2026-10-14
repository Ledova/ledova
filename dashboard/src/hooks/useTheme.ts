import { useSyncExternalStore } from 'react';
import { THEMES, THEME_STORAGE_KEY, parseTheme, type ThemeName } from '@ledova/shared';

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function currentTheme(): ThemeName {
  return parseTheme(document.documentElement.dataset.theme);
}

export function setTheme(theme: ThemeName) {
  if (theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEMES[theme].surface.base);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {}
  listeners.forEach((listener) => listener());
}

export function useTheme() {
  return useSyncExternalStore(subscribe, currentTheme);
}
