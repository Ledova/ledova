import { useState } from 'react';
import { RefreshControl, Text } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { formatDate } from '@ledova/shared';
import { LinkRow, Row, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { useAppTheme } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { holdingsOf, type PastHolding } from './holdings';
import { useMemberRecordsState } from './MemberRecordsProvider';

export function PastHoldingsScreen() {
  const theme = useAppTheme();
  const styles = useCompanyStyles();
  const [refreshing, setRefreshing] = useState(false);
  const navigation = useNavigation<NavigationProp<SignedInStackParamList>>();
  const { read } = useMemberRecordsState();
  const companies = new Map<string, PastHolding[]>();
  for (const holding of holdingsOf(read.records).past)
    companies.set(holding.record.uuid, [...(companies.get(holding.record.uuid) ?? []), holding]);
  return (
    <Page
      title="Past holdings"
      lede="Share classes you no longer hold."
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={theme.colors.interactive.active}
          onRefresh={() => {
            if (read.busy || refreshing) return;
            setRefreshing(true);
            void read.refresh().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      {read.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {read.error}
        </Text>
      )}
      {!read.owner || read.loading || (!read.listReady && !read.error) ? (
        <Text style={styles.muted}>Loading your holdings…</Text>
      ) : companies.size === 0 ? (
        !read.error && <Text style={styles.muted}>No past holdings.</Text>
      ) : (
        [...companies.values()].map((holdings) => (
          <Section key={holdings[0].record.uuid} title={holdings[0].record.company.name}>
            <Rows>
              {holdings.map(({ item }) => (
                <Row key={item.uuid} label={item.name}>
                  {item.ceasedOn ? `Ceased ${formatDate(item.ceasedOn)}` : 'No shares held'}
                </Row>
              ))}
              <LinkRow
                label={`Open ${holdings[0].record.company.name}`}
                onPress={() => navigation.navigate('Company', { record: holdings[0].record.uuid })}
              />
            </Rows>
          </Section>
        ))
      )}
    </Page>
  );
}
