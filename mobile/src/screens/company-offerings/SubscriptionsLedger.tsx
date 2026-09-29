import { useState } from 'react';
import { Text, View } from 'react-native';
import {
  formatDate,
  formatMoney,
  formatShareCount,
  REGISTER_COPY,
  useOfferingSubscriptions,
  type OfferingListItem,
} from '@ledova/shared';
import { Action, Row, Rows, Section } from '../../components/Ledger';
import { useCompanyStyles } from '../company-register/styles';
import { OfferingReadNotice } from './OfferingReadNotice';

export function SubscriptionsLedger({
  offerings,
  operatorName,
}: {
  offerings: OfferingListItem[];
  operatorName: string;
}) {
  const styles = useCompanyStyles();
  const [selected, setSelected] = useState('');
  const offering = offerings.find((row) => row.uuid === selected) ?? offerings[0];
  const read = useOfferingSubscriptions(offering?.uuid);
  if (!offering) return null;
  return (
    <Section title={REGISTER_COPY.APPLICATIONS_TITLE}>
      <Text style={styles.muted}>{REGISTER_COPY.APPLICATIONS_NOTE(operatorName)}</Text>
      <Text style={styles.text}>Offering</Text>
      {offerings.map((row) => (
        <Action
          key={row.uuid}
          label={`${row.tokenName} · ${row.statusDisplay} · ${formatDate(row.createdAt)}`}
          primary={row.uuid === offering.uuid}
          onPress={() => setSelected(row.uuid)}
        />
      ))}
      {read.isError ? (
        <OfferingReadNotice
          read={{ error: read.error, isRefreshing: read.isFetching, refetch: read.refetch }}
          label={REGISTER_COPY.APPLICATIONS_TITLE}
        />
      ) : read.isPending ? (
        <Text style={styles.muted}>Loading applications…</Text>
      ) : read.data.length === 0 ? (
        <Text style={styles.muted}>{REGISTER_COPY.APPLICATIONS_EMPTY}</Text>
      ) : (
        <>
          <Text style={styles.muted}>
            {read.data.length} application{read.data.length === 1 ? '' : 's'}
          </Text>
          {read.data.map((row) => (
            <View key={row.uuid} style={styles.entry}>
              <Text style={styles.heading}>{row.investorName || row.walletAddress}</Text>
              <Rows>
                <Row label="Status">{row.statusDisplay}</Row>
                <Row label="Requested shares">{formatShareCount(String(row.quantity))}</Row>
                <Row label="Allotted shares">
                  {row.allottedQuantity === null ? '—' : formatShareCount(String(row.allottedQuantity))}
                </Row>
                <Row label="Due">{formatMoney(row.amountDue, offering.priceCurrency)}</Row>
                <Row label="Received">
                  {row.amountReceived === null ? '—' : formatMoney(row.amountReceived, offering.priceCurrency)}
                </Row>
                <Row label="Payment method">{row.settlementRailDisplay}</Row>
                {!!row.reference && <Row label="Reference">{row.reference}</Row>}
                {!!row.paymentDueAt && <Row label="Payment due">{formatDate(row.paymentDueAt)}</Row>}
                {!!row.paymentConfirmedAt && <Row label="Payment confirmed">{formatDate(row.paymentConfirmedAt)}</Row>}
                <Row label="Allotment">{row.allotmentState}</Row>
              </Rows>
            </View>
          ))}
        </>
      )}
    </Section>
  );
}
