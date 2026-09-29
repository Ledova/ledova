import type { ReactNode } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text } from 'react-native';
import { GradientBackground } from '../../components/GradientBackground';
import { useAppTheme, useThemedStyles } from '../../contexts';

export function WalletsPage({
  children,
  title = 'Wallets',
  loading,
  refreshing,
  refresh,
}: {
  children: ReactNode;
  title?: string;
  loading: boolean;
  refreshing: boolean;
  refresh: () => void;
}) {
  const theme = useAppTheme();
  const styles = useWalletStyles();
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
          <ActivityIndicator accessibilityLabel="Loading wallets" color={theme.colors.brand.default} />
        ) : (
          children
        )}
      </ScrollView>
    </GradientBackground>
  );
}

export const useWalletStyles = () =>
  useThemedStyles((theme) => ({
    content: { padding: 24, gap: 28, paddingBottom: 48 },
    title: { fontFamily: theme.fontFamily.display, fontSize: 34, color: theme.colors.text.primary },
    message: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.primary },
    help: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.muted },
    name: { fontFamily: theme.fontFamily.medium, fontSize: 17, color: theme.colors.text.primary },
    group: { gap: 12 },
    actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 12 },
    item: { gap: 12, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border.default },
    lastItem: { paddingBottom: 0, borderBottomWidth: 0 },
    input: {
      fontFamily: theme.fontFamily.regular,
      color: theme.colors.text.primary,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: 6,
      padding: 12,
      fontSize: 16,
    },
  }));
