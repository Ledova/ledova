import { useState, type ReactNode } from 'react';
import { RefreshControl, Text } from 'react-native';
import type { useMemberRecords } from '@ledova/shared';
import { useAppTheme } from '../contexts';
import { useCompanyStyles } from '../hooks/useCompanyStyles';
import { Action, Actions } from './Ledger';

type Read = ReturnType<typeof useMemberRecords>;

export function MemberNotice({ read }: { read: Read }) {
  const styles = useCompanyStyles();
  return (
    <>
      {read.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {read.error}
        </Text>
      )}
      {read.retry && (
        <Actions>
          <Action label="Retry original member action" disabled={read.busy} onPress={() => void read.recover()} />
        </Actions>
      )}
    </>
  );
}

export function RecordGate({
  read,
  record,
  ready,
  children,
}: {
  read: Read;
  record: Read['records'][number] | undefined;
  ready: boolean;
  children: ReactNode;
}) {
  const styles = useCompanyStyles();
  if (!read.owner) return <Text style={styles.muted}>Check your signed-in account before opening member records.</Text>;
  if (read.loading || (!read.listReady && !read.error))
    return <Text style={styles.muted}>Loading member records…</Text>;
  if (!record)
    return read.error ? null : <Text style={styles.muted}>This company no longer records you as a member.</Text>;
  if (!ready) {
    if (read.retry)
      return <Text style={styles.muted}>Retry or finish your pending request before opening this company.</Text>;
    return read.error ? null : <Text style={styles.muted}>Loading member records…</Text>;
  }
  return <>{children}</>;
}

export function useMemberRefresh(read: Read, testID?: string, refresh: () => Promise<unknown> = read.refresh) {
  const theme = useAppTheme();
  const [refreshing, setRefreshing] = useState(false);
  return (
    <RefreshControl
      testID={testID}
      refreshing={refreshing}
      tintColor={theme.colors.interactive.active}
      onRefresh={() => {
        if (read.busy || refreshing) return;
        setRefreshing(true);
        void refresh().finally(() => setRefreshing(false));
      }}
    />
  );
}
