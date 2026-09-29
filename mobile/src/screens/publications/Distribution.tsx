import { View, Text } from 'react-native';
import { PUBLICATION_COPY, describePaymentStanding, describeRate, formatDate, formatMoney } from '@ledova/shared';
import type { Publication } from '@ledova/shared';
import { Row, Rows } from '../../components/Ledger';
import { useThemedStyles } from '../../contexts';

export function Distribution({ publication }: { publication: Publication }) {
  const styles = useThemedStyles((theme) => ({
    box: { gap: 8 },
    detail: { fontFamily: theme.fontFamily.regular, fontSize: 13, lineHeight: 20, color: theme.colors.text.muted },
    record: { fontFamily: theme.fontFamily.regular, fontSize: 15, lineHeight: 23, color: theme.colors.text.primary },
  }));
  if (publication.kind !== 'distribution') return null;
  const entitled = publication.myEntitlement !== null && publication.myEntitlement !== undefined;
  return (
    <View style={styles.box}>
      <Rows>
        <Row label={PUBLICATION_COPY.RATE_LABEL}>{describeRate(publication)}</Row>
        <Row label={PUBLICATION_COPY.PAYMENT_DATE_LABEL}>{formatDate(publication.paymentDate)}</Row>
        {entitled && (
          <Row label={PUBLICATION_COPY.ENTITLEMENT_LABEL}>
            {formatMoney(publication.myEntitlement ?? '0', publication.currency ?? '')}
          </Row>
        )}
      </Rows>
      {entitled && (
        <>
          <Text style={styles.detail}>{PUBLICATION_COPY.ENTITLEMENT_HELP}</Text>
          <Text style={styles.record}>{describePaymentStanding(publication)}</Text>
          <Text style={styles.detail}>{PUBLICATION_COPY.RECORDS_ONLY}</Text>
        </>
      )}
    </View>
  );
}
