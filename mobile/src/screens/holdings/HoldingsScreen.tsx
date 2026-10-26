import { useState } from 'react';
import * as Crypto from 'expo-crypto';
import { RefreshControl, Text } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useMemberRecords } from '@ledova/shared';
import { Action, LinkRow, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { useAppTheme } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { CompanyCard, CompanyList } from './CompanyHoldings';
import { holdingsOf, holdingsSummary, LIST_ABOVE } from './holdings';
import { MemberInvitation } from './MemberInvitation';

export function HoldingsScreen() {
  const read = useMemberRecords(Crypto.randomUUID, orderSubmissionSession);
  return (
    <Holdings
      key={`${read.owner?.userUuid}/${read.owner?.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}`}
      read={read}
    />
  );
}

function Holdings({ read }: { read: ReturnType<typeof useMemberRecords> }) {
  const theme = useAppTheme();
  const styles = useCompanyStyles();
  const navigation = useNavigation<NavigationProp<SignedInStackParamList>>();
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [invitationOpen, setInvitationOpen] = useState(false);
  const held = read.busy || !!read.retry;
  const { current, past } = holdingsOf(read.records);
  const open = (record: string) => navigation.navigate('Company', { record });
  return (
    <Page
      testID="holdings-scroll"
      title="Holdings"
      lede={current.length > 0 ? holdingsSummary(current) : undefined}
      refreshControl={
        <RefreshControl
          testID="holdings-refresh"
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
      {read.retry && (
        <Action label="Retry original member action" disabled={read.busy} onPress={() => void read.recover()} />
      )}
      {!read.owner ? (
        <Text style={styles.muted}>Check your signed-in account before opening your holdings.</Text>
      ) : read.loading || (read.busy && read.records.length === 0) ? (
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
          {!read.error && read.records.length === 0 ? (
            <Section title="Get access to your shares">
              <Text style={styles.muted}>
                Accept your company&apos;s invitation to see your shares and employee awards here.
              </Text>
              <MemberInvitation read={read} held={held} />
            </Section>
          ) : (
            <Section title="Member invitation">
              <Action
                label={invitationOpen ? 'Hide member invitation' : 'Accept another member invitation'}
                disabled={held}
                onPress={() => setInvitationOpen((value) => !value)}
              />
              {invitationOpen && <MemberInvitation read={read} held={held} />}
            </Section>
          )}
        </>
      )}
    </Page>
  );
}
