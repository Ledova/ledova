import type { ReactNode } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text } from 'react-native';
import { GradientBackground } from '../../components/GradientBackground';
import { useAppTheme, useThemedStyles } from '../../contexts';

export function DirectoryPage({
  children,
  loading,
  refreshing,
  refresh,
  title = 'Directory',
}: {
  children?: ReactNode;
  loading: boolean;
  refreshing: boolean;
  refresh: () => void;
  title?: string;
}) {
  const theme = useAppTheme();
  const styles = useDirectoryStyles();
  return (
    <GradientBackground>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing && !loading}
            onRefresh={refresh}
            tintColor={theme.colors.brand.default}
          />
        }
      >
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {loading ? (
          <ActivityIndicator accessibilityLabel="Loading directory" color={theme.colors.brand.default} />
        ) : (
          children
        )}
      </ScrollView>
    </GradientBackground>
  );
}

export const useDirectoryStyles = () =>
  useThemedStyles((theme) => ({
    content: { padding: 24, gap: 28, paddingBottom: 48 },
    title: { fontFamily: theme.fontFamily.display, fontSize: 34, color: theme.colors.text.primary },
    message: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.primary },
    help: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.muted },
    group: { gap: 12 },
  }));
