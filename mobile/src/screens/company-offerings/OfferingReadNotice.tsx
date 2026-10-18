import { Text, View } from 'react-native';
import { Action } from '../../components/Ledger';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { CompanyRead } from '../../components/company/CompanyState';

export function OfferingReadNotice({ read, label = 'Offering information' }: { read: CompanyRead; label?: string }) {
  const styles = useCompanyStyles();
  return read.error ? (
    <View style={styles.group}>
      <Text accessibilityRole="alert" style={styles.error}>
        {label} could not be loaded. Try again before continuing.
      </Text>
      <Action label={`Retry ${label.toLowerCase()}`} disabled={read.isRefreshing} onPress={() => void read.refetch()} />
    </View>
  ) : read.isRefreshing ? (
    <Text style={styles.muted}>Refreshing {label.toLowerCase()}…</Text>
  ) : null;
}
