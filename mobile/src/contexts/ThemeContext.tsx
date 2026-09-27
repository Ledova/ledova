import React, { createContext, useContext, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { DESIGN_TOKENS, PAPER_THEME } from '@ledova/shared';

const THEME = {
  ...DESIGN_TOKENS,
  colors: PAPER_THEME,
  fontFamily: {
    display: 'Newsreader_500Medium',
    regular: 'InstrumentSans_400Regular',
    medium: 'InstrumentSans_500Medium',
    semibold: 'InstrumentSans_600SemiBold',
    bold: 'InstrumentSans_700Bold',
  },
  icon: {
    ...DESIGN_TOKENS.icon,
    colors: {
      primary: PAPER_THEME.text.primary,
      muted: PAPER_THEME.text.subtle,
    },
  },
} as const;

type ThemeObject = typeof THEME;

const ThemeContext = createContext(THEME);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <ThemeContext.Provider value={THEME}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  return useContext(ThemeContext);
}

export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(stylesFn: (theme: ThemeObject) => T): T {
  const theme = useContext(ThemeContext);
  return useMemo(() => StyleSheet.create(stylesFn(theme)), [stylesFn, theme]);
}

export const overlayColors = {
  modal: 'rgba(0, 0, 0, 0.5)',
} as const;

export const createStyles = StyleSheet.create;
