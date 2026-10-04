import { Text, View } from 'react-native';
import { Action } from '../../components/Ledger';
import { useCompanyStyles } from '../company-register/styles';
import type { useCompanyProfile } from '../../hooks/useCompanyProfile';

export type CompanyRead = { error: unknown; isRefreshing: boolean; refetch: () => Promise<unknown> };
export type CompanyActionRead = ReturnType<typeof useCompanyProfile>;

export function CompanyReadNotice({ read }: { read: CompanyRead }) {
  const styles = useCompanyStyles();
  return read.error ? (
    <View style={styles.group}>
      <Text accessibilityRole="alert" style={styles.error}>
        Company information could not be loaded. Try again before continuing.
      </Text>
      <Action label="Retry company information" disabled={read.isRefreshing} onPress={() => void read.refetch()} />
    </View>
  ) : read.isRefreshing ? (
    <Text style={styles.muted}>Refreshing company information…</Text>
  ) : null;
}
