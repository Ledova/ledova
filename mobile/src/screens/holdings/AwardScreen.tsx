import { Text, View } from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import { formatDate, formatShareCount } from '@ledova/shared';
import { Rows, Section, useCardStyles } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { AwardBar, useAwardLooks } from './AwardBar';
import { Figure } from './Figure';
import { awardParts, shareTotal, type AwardPart, type MemberAward } from './holdings';
import { MemberNotice, RecordGate, useCompanyRecord, useMemberRefresh } from './MemberRecordsProvider';

const PARTS: Record<AwardPart, string> = {
  issued: 'Issued to you',
  available: 'Vested, not yet issued',
  unvested: 'Still to vest',
  ended: 'Rights ended',
};

function useAwardStyles() {
  return useThemedStyles((theme) => ({
    summary: { gap: theme.spacing.md },
    row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: theme.spacing.smd, paddingVertical: 10 },
    dot: { width: 10, height: 10, borderRadius: 5 },
    grow: { flex: 1, gap: 2 },
    quantity: { fontFamily: theme.fontFamily.medium, fontSize: 14, color: theme.colors.text.primary },
    item: { gap: 2, paddingVertical: 10 },
  }));
}

function historyOf(award: MemberAward) {
  const vestedOn = (uuid: string) => award.vestings.find((event) => event.uuid === uuid)?.vestedOn;
  return [
    ...award.vestings.map((event) => ({
      uuid: event.uuid,
      on: event.vestedOn,
      kind: 'Vested',
      quantity: formatShareCount(event.shares),
      detail: null,
    })),
    ...award.ends.map((event) => ({
      uuid: event.uuid,
      on: event.companyEventOn,
      kind: 'Rights ended',
      quantity: shareTotal(event.unvestedShares, event.vestedShares),
      detail: `${formatShareCount(event.unvestedShares)} unvested and ${formatShareCount(event.vestedShares)} vested not yet issued · ${event.reason}`,
    })),
    ...award.vestingReversals.map((event) => {
      const original = vestedOn(event.vesting);
      return {
        uuid: event.uuid,
        on: event.companyEventOn,
        kind: 'Vesting reversed',
        quantity: formatShareCount(event.reversedShares),
        detail: original ? `Corrects the vesting of ${formatDate(original)} · ${event.reason}` : event.reason,
      };
    }),
  ].sort((a, b) => b.on.localeCompare(a.on));
}

export function AwardScreen({ route }: { route: RouteProp<SignedInStackParamList, 'Award'> }) {
  const styles = useCompanyStyles();
  const card = useCardStyles();
  const look = useAwardStyles();
  const looks = useAwardLooks();
  const { read, record } = useCompanyRecord(route.params.record);
  const award = record?.awards.find((item) => item.uuid === route.params.award);
  const refresh = useMemberRefresh(read, 'award-scroll-refresh');
  const parts = award ? awardParts(award) : null;
  const className = record?.classes.find((item) => item.uuid === award?.token)?.name;
  const history = award ? historyOf(award) : [];
  return (
    <Page
      testID="award-scroll"
      title="Employee award"
      lede={[className && `${className} shares`, record?.company.name].filter(Boolean).join(' · ') || undefined}
      refreshControl={refresh}
    >
      <MemberNotice read={read} />
      <RecordGate read={read} record={record} ready>
        {!award ? (
          <Text style={styles.muted}>This award is no longer recorded for you.</Text>
        ) : (
          <>
            {parts ? (
              <View style={look.summary}>
                <Figure
                  value={formatShareCount(award.vestedShares)}
                  caption={`of ${formatShareCount(award.shares)} vested`}
                />
                <AwardBar award={award} height={8} />
                <View>
                  {parts
                    .filter(({ part, quantity }) => part !== 'ended' || quantity > 0n)
                    .map(({ part, quantity }) => (
                      <View
                        key={part}
                        accessible
                        accessibilityLabel={`${PARTS[part]}: ${formatShareCount(String(quantity))}`}
                        style={look.row}
                      >
                        <View style={[look.dot, looks[part]]} />
                        <Text style={[styles.text, look.grow]}>{PARTS[part]}</Text>
                        <Text style={look.quantity}>{formatShareCount(String(quantity))}</Text>
                      </View>
                    ))}
                </View>
              </View>
            ) : (
              <Text style={styles.muted}>Award quantities are unavailable. Refresh the current record.</Text>
            )}
            <View style={card.card}>
              <Rows>
                <View style={look.item}>
                  <Text style={styles.text}>Schedule</Text>
                  <Text style={styles.muted}>{award.schedule}</Text>
                  <Text style={styles.muted}>Dates do not vest an award automatically.</Text>
                </View>
                <View style={look.item}>
                  <Text style={styles.text}>Terms</Text>
                  <Text style={styles.muted}>
                    {award.terms} · {formatDate(award.termsOn)}
                  </Text>
                </View>
              </Rows>
            </View>
            <Section title="History">
              {history.length === 0 ? (
                <Text style={styles.muted}>No vesting recorded yet.</Text>
              ) : (
                <Rows>
                  {history.map((event) => (
                    <View
                      key={event.uuid}
                      accessible
                      accessibilityLabel={`${event.kind}, ${formatDate(event.on)}, ${event.quantity}${event.detail ? `, ${event.detail}` : ''}`}
                      style={look.row}
                    >
                      <View style={look.grow}>
                        <Text style={styles.text}>{event.kind}</Text>
                        <Text style={styles.muted}>{formatDate(event.on)}</Text>
                        {event.detail && <Text style={styles.muted}>{event.detail}</Text>}
                      </View>
                      <Text style={look.quantity}>{event.quantity}</Text>
                    </View>
                  ))}
                </Rows>
              )}
            </Section>
          </>
        )}
      </RecordGate>
    </Page>
  );
}
