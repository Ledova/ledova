import { Text, View } from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import { REGISTER_AWARD_COPY as AWARD_COPY, formatShareCount } from '@ledova/shared';
import { Row, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { MemberNotice, RecordGate, useCompanyRecord, useMemberRefresh } from './MemberRecordsProvider';

export function AwardScreen({ route }: { route: RouteProp<SignedInStackParamList, 'Award'> }) {
  const styles = useCompanyStyles();
  const { read, record } = useCompanyRecord(route.params.record);
  const award = record?.awards.find((item) => item.uuid === route.params.award);
  const refresh = useMemberRefresh(read, 'award-scroll-refresh');
  return (
    <Page testID="award-scroll" title="Employee award" lede={record?.company.name} refreshControl={refresh}>
      <MemberNotice read={read} />
      <RecordGate read={read} record={record} ready>
        {!award ? (
          <Text style={styles.muted}>This award is no longer recorded for you.</Text>
        ) : (
          <Section title={`${formatShareCount(award.vestedShares)} of ${formatShareCount(award.shares)} vested`}>
            <Text style={styles.muted}>Promised and recorded vested shares are separate from issued shares.</Text>
            <Text style={styles.text}>
              {formatShareCount(award.shares)} awarded · {formatShareCount(award.vestedShares)} vested ·{' '}
              {formatShareCount(award.issuedShares)} issued · {formatShareCount(award.availableShares)} available
            </Text>
            <View style={styles.group}>
              <Text style={styles.muted}>
                {award.termsOn} · {award.terms}
              </Text>
              <Text style={styles.muted}>{award.schedule}</Text>
              <Rows>
                <Row label={AWARD_COPY.ENDED_UNVESTED}>{award.endedUnvestedShares}</Row>
                <Row label={AWARD_COPY.ENDED_VESTED}>{award.endedVestedShares}</Row>
                <Row label={AWARD_COPY.UNVESTED_REMAINING}>{award.unvestedRemainingShares}</Row>
                <Row label={AWARD_COPY.REMAINING_UNISSUED}>{award.remainingUnissuedShares}</Row>
              </Rows>
              {award.vestings.map((event) => (
                <Text key={event.uuid} style={styles.muted}>
                  {event.vestedOn} · {formatShareCount(event.shares)} recorded vested
                </Text>
              ))}
              {award.ends.map((event) => (
                <Text key={event.uuid} style={styles.muted}>
                  {event.companyEventOn} · {formatShareCount(event.unvestedShares)} unvested and{' '}
                  {formatShareCount(event.vestedShares)} vested unissued rights ended · {event.reason}
                </Text>
              ))}
              {award.vestingReversals.map((event) => (
                <Text key={event.uuid} style={styles.muted}>
                  {event.companyEventOn} · {formatShareCount(event.reversedShares)} vesting reversed · original{' '}
                  {event.vesting} · {event.reason}
                </Text>
              ))}
            </View>
          </Section>
        )}
      </RecordGate>
    </Page>
  );
}
