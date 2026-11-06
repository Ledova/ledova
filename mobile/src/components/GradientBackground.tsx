import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useAppTheme } from '../contexts';

export function GradientBackground({ children }: { children: ReactNode }) {
  const theme = useAppTheme();
  return <View style={{ flex: 1, backgroundColor: theme.colors.surface.base }}>{children}</View>;
}
