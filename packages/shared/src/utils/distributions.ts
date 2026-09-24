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
