import type { ReactNode } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text } from 'react-native';
import { GradientBackground } from '../../components/GradientBackground';
import { useAppTheme, useThemedStyles } from '../../contexts';

export function ApplicationsPage({
  children,
  loading,
  refreshing,
  refresh,
  title = 'Applications',
}: {
  children?: ReactNode;
  loading: boolean;
  refreshing: boolean;
  refresh: () => void;
  title?: string;
}) {
  const theme = useAppTheme();
  const styles = useApplicationStyles();
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
          <ActivityIndicator accessibilityLabel="Loading applications" color={theme.colors.brand.default} />
        ) : (
          children
        )}
      </ScrollView>
    </GradientBackground>
  );
}

export const useApplicationStyles = () =>
  useThemedStyles((theme) => ({
    content: { padding: 24, gap: 28, paddingBottom: 48 },
    title: { fontFamily: theme.fontFamily.display, fontSize: 34, color: theme.colors.text.primary },
    message: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.primary },
    help: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.muted },
    item: { paddingVertical: 16, gap: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border.subtle },
    label: { fontFamily: theme.fontFamily.medium, fontSize: 16, lineHeight: 23, color: theme.colors.text.primary },
    group: { gap: 12 },
  }));
