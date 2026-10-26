import { Text } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { formatDate } from '@ledova/shared';
import { LinkRow, Row, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { holdingsOf, type PastHolding } from './holdings';
import { MemberNotice, useMemberRecordsState, useMemberRefresh } from './MemberRecordsProvider';

export function PastHoldingsScreen() {
  const styles = useCompanyStyles();
  const navigation = useNavigation<NavigationProp<SignedInStackParamList>>();
  const { read } = useMemberRecordsState();
  const refresh = useMemberRefresh(read);
  const companies = new Map<string, PastHolding[]>();
  for (const holding of holdingsOf(read.records).past)
    companies.set(holding.record.uuid, [...(companies.get(holding.record.uuid) ?? []), holding]);
  return (
    <Page title="Past holdings" lede="Share classes you no longer hold." refreshControl={refresh}>
      <MemberNotice read={read} />
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
