import type { ReactNode } from 'react';
import { ActivityIndicator, RefreshControl } from 'react-native';
import { Page } from '../../components/Page';
import { useAppTheme } from '../../contexts';

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
          tintColor={theme.colors.interactive.active}
        />
      }
    >
      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading applications" color={theme.colors.interactive.active} />
      ) : (
        children
      )}
    </Page>
  );
}
