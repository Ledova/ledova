import { PUBLICATION_COPY, describePaymentStanding, describeRate, formatDate, formatMoney } from '@ledova/shared';
import type { Publication } from '@ledova/shared';
import { Row, Rows } from '@components/Ledger';

export function Distribution({ publication }: { publication: Publication }) {
  if (publication.kind !== 'distribution') return null;
  const entitled = publication.myEntitlement !== null && publication.myEntitlement !== undefined;

  return (
    <div className="flex flex-col gap-2">
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
          <p className="text-xs text-text-muted">{PUBLICATION_COPY.ENTITLEMENT_HELP}</p>
          <p className="text-sm text-text-primary">{describePaymentStanding(publication)}</p>
          <p className="text-xs text-text-muted">{PUBLICATION_COPY.RECORDS_ONLY}</p>
        </>
      )}
    </div>
  );
}
