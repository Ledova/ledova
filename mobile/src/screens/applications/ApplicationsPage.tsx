import type { ReactNode } from 'react';
import { ActivityIndicator, RefreshControl } from 'react-native';
import { Page } from '../../components/Page';
import { useAppTheme, useThemedStyles } from '../../contexts';

export function ApplicationsPage({
  children,
  loading,
  refreshing,
  refresh,
  title = 'Applications',
  actions,
}: {
  children?: ReactNode;
  loading: boolean;
  refreshing: boolean;
  refresh: () => void;
  title?: string;
  actions?: ReactNode;
}) {
  const theme = useAppTheme();
  return (
    <Page
      title={title}
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
        <ActivityIndicator accessibilityLabel="Loading applications" color={theme.colors.brand.default} />
      ) : (
        children
      )}
    </Page>
  );
}

export const useApplicationStyles = () =>
  useThemedStyles((theme) => ({
    message: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.primary },
    help: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.muted },
    item: { paddingVertical: 16, gap: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border.subtle },
    label: { fontFamily: theme.fontFamily.medium, fontSize: 16, lineHeight: 23, color: theme.colors.text.primary },
    group: { gap: 12 },
  }));
