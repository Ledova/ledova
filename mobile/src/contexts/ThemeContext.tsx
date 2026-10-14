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

const ThemeContext = createContext<ThemeObject>(APP_THEMES.paper);
const ThemeChoiceContext = createContext<(mode: ThemeName) => void>(() => {});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeName | null>(null);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then(parseTheme, () => 'paper' as const)
      .then((stored) => {
        if (active) setMode(stored);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!mode) return;
    Appearance.setColorScheme(mode === 'dark' ? 'dark' : 'light');
    SystemUI.setBackgroundColorAsync(APP_THEMES[mode].colors.surface.base).catch(() => {});
  }, [mode]);

  const choose = useCallback((next: ThemeName) => {
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
