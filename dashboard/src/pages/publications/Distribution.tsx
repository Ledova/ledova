import { PUBLICATION_COPY, describePaymentStanding, describeRate, formatDate, formatMoney } from '@ledova/shared';
import type { Publication } from '@ledova/shared';

export function Distribution({ publication }: { publication: Publication }) {
  if (publication.kind !== 'distribution') return null;
  const entitled = publication.myEntitlement !== null && publication.myEntitlement !== undefined;

  return (
    <div className="mt-3 rounded-lg bg-surface-tertiary/30 px-3 py-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-text-muted">{PUBLICATION_COPY.RATE_LABEL}</dt>
        <dd className="text-text-primary font-mono">{describeRate(publication)}</dd>
        <dt className="text-text-muted">{PUBLICATION_COPY.PAYMENT_DATE_LABEL}</dt>
        <dd className="text-text-primary">{formatDate(publication.paymentDate)}</dd>
        {entitled && (
          <>
            <dt className="text-text-muted">{PUBLICATION_COPY.ENTITLEMENT_LABEL}</dt>
            <dd className="text-text-primary font-mono font-semibold">
              {formatMoney(publication.myEntitlement ?? '0', publication.currency ?? '')}
            </dd>
          </>
        )}
      </dl>
      {entitled && (
        <>
          <p className="text-xs text-text-muted mt-1">{PUBLICATION_COPY.ENTITLEMENT_HELP}</p>
          <p className="text-sm text-text-primary mt-3">{describePaymentStanding(publication)}</p>
          <p className="text-xs text-text-muted mt-1">{PUBLICATION_COPY.RECORDS_ONLY}</p>
        </>
      )}
    </div>
  );
}
