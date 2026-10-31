import { useState } from 'react';
import { Text, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import type { useMemberRecords } from '@ledova/shared';
import { Action, LinkRow, Rows, useCardStyles } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { CompanyCard, CompanyList } from './CompanyHoldings';
import { holdingsOf, holdingsSummary, LIST_ABOVE } from './holdings';
import { MemberNotice, useMemberRecordsState, useMemberRefresh } from './MemberRecordsProvider';

export function HoldingsScreen() {
  const { read } = useMemberRecordsState();
  return (
    <Holdings
      key={`${read.owner?.userUuid}/${read.owner?.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}`}
      read={read}
    />
  );
}

function Holdings({ read }: { read: ReturnType<typeof useMemberRecords> }) {
  const styles = useCompanyStyles();
  const card = useCardStyles();
  const navigation = useNavigation<NavigationProp<SignedInStackParamList>>();
  const refresh = useMemberRefresh(read, 'holdings-refresh');
  const [query, setQuery] = useState('');
  const { current, past } = holdingsOf(read.records);
  const open = (record: string) => navigation.navigate('Company', { record });
  return (
    <Page
      testID="holdings-scroll"
      title="Dashboard"
      lede={current.length > 0 ? holdingsSummary(current) : undefined}
      refreshControl={refresh}
    >
      <MemberNotice read={read} />
      {!read.owner ? (
        <Text style={styles.muted}>Check your signed-in account before opening your holdings.</Text>
      ) : read.loading || (!read.listReady && !read.error) ? (
        <Text style={styles.muted}>Loading your holdings…</Text>
      ) : (
        <>
          {current.length > LIST_ABOVE ? (
            <CompanyList holdings={current} query={query} onQuery={setQuery} onOpen={open} />
          ) : (
            current.map((holding) => <CompanyCard key={holding.record.uuid} holding={holding} onOpen={open} />)
          )}
          {past.length > 0 && (
            <Rows>
              <LinkRow label={`Past holdings (${past.length})`} onPress={() => navigation.navigate('PastHoldings')} />
            </Rows>
          )}
          {!read.error && read.records.length === 0 && (
            <View style={card.card}>
              <Text style={styles.heading}>No shares yet</Text>
              <Text style={styles.muted}>
                When a company invites you to its share register, your shares, awards and documents appear here.
              </Text>
              <Action label="Accept an invitation" primary onPress={() => navigation.navigate('Invitation')} />
            </View>
          )}
        </>
      )}
    </Page>
  );
}
