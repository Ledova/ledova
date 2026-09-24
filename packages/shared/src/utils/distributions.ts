import { PUBLICATION_COPY, formatShareCount } from '../constants';
import type { Publication, PublicationPaymentRecord } from '../types';
import { formatDate } from './date';

function amountIn(currency: string, amount: string, fractionOf: (fraction: string) => string): string {
  const [whole = '0', fraction = ''] = amount.split('.');
  return `${currency} ${formatShareCount(whole)}.${fractionOf(fraction)}`;
}

export const formatMoney = (amount: string, currency: string) =>
  amountIn(currency, amount, (fraction) => fraction.padEnd(2, '0'));

export function describeRate(publication: Pick<Publication, 'ratePerShare' | 'currency'>): string | null {
  if (!publication.ratePerShare || !publication.currency) return null;
  const rate = amountIn(publication.currency, publication.ratePerShare, (fraction) =>
    fraction.replace(/0+$/, '').padEnd(2, '0'),
  );
  return `${rate} ${PUBLICATION_COPY.PER_SHARE}`;
}

export const describePaymentRecord = (record: PublicationPaymentRecord) =>
  `${PUBLICATION_COPY.RECORDED_AS_PAID} ${formatDate(record.recordedPaidOn)}, ` +
  `${PUBLICATION_COPY.REFERENCE} ${record.reference}.`;

export type PaymentRecordState = 'unrecorded' | 'partly_recorded' | 'recorded';

type PaymentStanding = Pick<Publication, 'myEntitlement' | 'myRecordedEntitlement' | 'myPaymentRecord' | 'currency'>;

function cents(amount: string | null | undefined): bigint {
  const [whole = '0', fraction = ''] = (amount ?? '0').split('.');
  return BigInt(whole) * 100n + BigInt(`${fraction}00`.slice(0, 2));
}

export function paymentRecordState(publication: Omit<PaymentStanding, 'currency'>): PaymentRecordState {
  const recorded = cents(publication.myRecordedEntitlement);
  if (!publication.myPaymentRecord || recorded === 0n) return 'unrecorded';
  return recorded < cents(publication.myEntitlement) ? 'partly_recorded' : 'recorded';
}

export function describePaymentStanding(publication: PaymentStanding): string {
  const record = publication.myPaymentRecord;
  const state = paymentRecordState(publication);
  if (record && state === 'recorded') return describePaymentRecord(record);
  if (record && state === 'partly_recorded') {
    const currency = publication.currency ?? '';
    return PUBLICATION_COPY.PART_RECORDED.replace(
      '{recorded}',
      formatMoney(publication.myRecordedEntitlement ?? '0', currency),
    )
      .replace('{entitlement}', formatMoney(publication.myEntitlement ?? '0', currency))
      .replace('{date}', formatDate(record.recordedPaidOn))
      .replace('{reference}', record.reference);
  }
  return cents(publication.myEntitlement) === 0n
    ? PUBLICATION_COPY.NOTHING_PAYABLE
    : PUBLICATION_COPY.NO_PAYMENT_RECORDED;
}
