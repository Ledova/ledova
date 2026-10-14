import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, Platform, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SystemUI from 'expo-system-ui';
import { DESIGN_TOKENS, THEMES, THEME_STORAGE_KEY, parseTheme, type ThemeName } from '@ledova/shared';

const BASE = {
  ...DESIGN_TOKENS,
  spacing: { ...DESIGN_TOKENS.spacing, smd: 12 },
  fontFamily: {
    display: 'Newsreader_500Medium',
    regular: 'InstrumentSans_400Regular',
    medium: 'InstrumentSans_500Medium',
    semibold: 'InstrumentSans_600SemiBold',
    bold: 'InstrumentSans_700Bold',
    mono: Platform.select({ ios: 'ui-monospace', default: 'monospace' }),
  },
} as const;

function buildTheme(mode: ThemeName) {
  return { ...BASE, colors: THEMES[mode], mode };
}

const APP_THEMES = { paper: buildTheme('paper'), dark: buildTheme('dark') };

type ThemeObject = ReturnType<typeof buildTheme>;

const STORED_THEME_TIMEOUT_MS = 2000;

function applyNativeAppearance(mode: ThemeName) {
  Appearance.setColorScheme(mode === 'dark' ? 'dark' : 'light');
  SystemUI.setBackgroundColorAsync(APP_THEMES[mode].colors.surface.base).catch(() => {});
}

const ThemeContext = createContext<ThemeObject>(APP_THEMES.paper);
const ThemeChoiceContext = createContext<(mode: ThemeName) => void>(() => {});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeName | null>(null);

  useEffect(() => {
    let pending = true;
    const settle = (stored: ThemeName) => {
      if (!pending) return;
      pending = false;
      clearTimeout(timer);
      applyNativeAppearance(stored);
      setMode(stored);
    };
    const timer = setTimeout(() => settle('paper'), STORED_THEME_TIMEOUT_MS);
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then(parseTheme, () => 'paper' as const)
      .then(settle);
    return () => {
      pending = false;
      clearTimeout(timer);
    };
  }, []);

  const choose = useCallback((next: ThemeName) => {
    applyNativeAppearance(next);
    setMode(next);
    AsyncStorage.setItem(THEME_STORAGE_KEY, next).catch(() => {});
  }, []);

  if (!mode) return null;
  return (
    <ThemeContext.Provider value={APP_THEMES[mode]}>
      <ThemeChoiceContext.Provider value={choose}>{children}</ThemeChoiceContext.Provider>
    </ThemeContext.Provider>
  );
}

export function useAppTheme() {
  return useContext(ThemeContext);
}

export function useThemeChoice() {
  return { mode: useContext(ThemeContext).mode, setMode: useContext(ThemeChoiceContext) };
}

export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(stylesFn: (theme: ThemeObject) => T): T {
  const theme = useContext(ThemeContext);
  return useMemo(() => StyleSheet.create(stylesFn(theme)), [stylesFn, theme]);
}

export const overlayColors = {
  modal: 'rgba(0, 0, 0, 0.5)',
} as const;
