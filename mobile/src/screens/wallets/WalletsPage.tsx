import type { ReactNode } from 'react';
import { ActivityIndicator, RefreshControl } from 'react-native';
import { Page } from '../../components/Page';
import { useAppTheme, useThemedStyles } from '../../contexts';

export function WalletsPage({
  children,
  title = 'Wallets',
  lede,
  actions,
  loading,
  refreshing,
  refresh,
}: {
  children: ReactNode;
  title?: string;
  lede?: string;
  actions?: ReactNode;
  loading: boolean;
  refreshing: boolean;
  refresh: () => void;
}) {
  const theme = useAppTheme();
  return (
    <Page
      title={title}
      lede={lede}
      actions={actions}
      refreshControl={
        <RefreshControl
          refreshing={refreshing && !loading}
          onRefresh={refresh}
          tintColor={theme.colors.brand.default}
        />
      }
    >
      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading wallets" color={theme.colors.brand.default} />
      ) : (
        children
      )}
    </Page>
  );
}

export const useWalletStyles = () =>
  useThemedStyles((theme) => ({
    message: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.primary },
    help: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.muted },
    group: { gap: theme.spacing.smd },
    actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: theme.spacing.smd },
    item: {
      gap: theme.spacing.smd,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border.default,
    },
    lastItem: { paddingBottom: 0, borderBottomWidth: 0 },
    input: {
      fontFamily: theme.fontFamily.regular,
      color: theme.colors.text.primary,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: 6,
      padding: theme.spacing.smd,
      fontSize: 16,
    },
  }));
