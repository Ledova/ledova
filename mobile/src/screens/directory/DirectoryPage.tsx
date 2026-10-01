import type { ReactNode } from 'react';
import { ActivityIndicator, RefreshControl } from 'react-native';
import { Page } from '../../components/Page';
import { useAppTheme, useThemedStyles } from '../../contexts';

export function DirectoryPage({
  children,
  loading,
  refreshing,
  refresh,
  title = 'Directory',
  lede,
  actions,
}: {
  children?: ReactNode;
  loading: boolean;
  refreshing: boolean;
  refresh: () => void;
  title?: string;
  lede?: string;
  actions?: ReactNode;
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
        <ActivityIndicator accessibilityLabel="Loading directory" color={theme.colors.brand.default} />
      ) : (
        children
      )}
    </Page>
  );
}

export const useDirectoryStyles = () =>
  useThemedStyles((theme) => ({
    message: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.primary },
    help: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.muted },
    group: { gap: 12 },
    document: { gap: theme.spacing.sm, paddingVertical: theme.spacing.smd },
  }));
