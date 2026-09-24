import React from 'react';
import { View, Text } from 'react-native';
import { PUBLICATION_COPY, describePaymentRecord, describeRate, formatDate, formatMoney } from '@ledova/shared';
import type { Publication } from '@ledova/shared';
import { useThemedStyles } from '../../contexts';

function paymentLine(publication: Publication) {
  if (publication.myPaymentRecord) return describePaymentRecord(publication.myPaymentRecord);
  if (Number(publication.myEntitlement) === 0) return PUBLICATION_COPY.NOTHING_PAYABLE;
  return PUBLICATION_COPY.NO_PAYMENT_RECORDED;
}

export function Distribution({ publication }: { publication: Publication }) {
  const styles = useThemedStyles((theme) => ({
    box: {
      marginTop: theme.spacing.sm,
      padding: theme.spacing.sm,
      borderRadius: theme.borderRadius.sm,
      backgroundColor: theme.colors.surface.tertiary,
    },
    detail: { fontSize: theme.fontSize.xs, color: theme.colors.text.muted, marginTop: 2 },
    entitlement: {
      fontSize: theme.fontSize.sm,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.text.primary,
      marginTop: theme.spacing.xs,
    },
    record: { fontSize: theme.fontSize.sm, color: theme.colors.text.primary, marginTop: theme.spacing.sm },
  }));
  if (publication.kind !== 'distribution') return null;
  const entitled = publication.myEntitlement !== null && publication.myEntitlement !== undefined;

  return (
    <View style={styles.box}>
      <Text style={styles.detail}>{`${PUBLICATION_COPY.RATE_LABEL}: ${describeRate(publication) ?? ''}`}</Text>
      <Text style={styles.detail}>
        {`${PUBLICATION_COPY.PAYMENT_DATE_LABEL}: ${formatDate(publication.paymentDate)}`}
      </Text>
      {entitled && (
        <>
          <Text style={styles.entitlement}>
            {`${PUBLICATION_COPY.ENTITLEMENT_LABEL}: ${formatMoney(publication.myEntitlement ?? '0', publication.currency ?? '')}`}
          </Text>
          <Text style={styles.detail}>{PUBLICATION_COPY.ENTITLEMENT_HELP}</Text>
          <Text style={styles.record}>{paymentLine(publication)}</Text>
          <Text style={styles.detail}>{PUBLICATION_COPY.RECORDS_ONLY}</Text>
        </>
      )}
    </View>
  );
}
