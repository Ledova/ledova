import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useAppTheme } from '../contexts';

export function GradientBackground({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useAppTheme();
  return <View style={[{ flex: 1, backgroundColor: theme.colors.surface.base }, style]}>{children}</View>;
}
