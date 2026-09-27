import { formatShareCount, type Subscription, type SubscriptionDetail } from '@ledova/shared';

const STATES: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Under review by the operator',
  accepted: 'Accepted, payment instruction next',
  awaiting_payment: 'Awaiting your payment',
  paid: 'Payment received, allotment next',
  allotted: 'Shares allotted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  refunded: 'Refunded',
};

export function applicationState(application: Pick<Subscription, 'status' | 'statusDisplay'>) {
  return STATES[application.status] ?? application.statusDisplay;
}

export function applicationShares(quantity: number) {
  return Number.isSafeInteger(quantity) && quantity >= 0 ? formatShareCount(String(quantity)) : 'Unavailable';
}

export function applicationHistory(application: SubscriptionDetail) {
  const events: [string, string | null | undefined][] = [
    ['Drafted', application.createdAt],
    ['Submitted for review', application.submittedAt],
    ['Accepted by the operator', application.acceptedAt],
    ['Payment instruction issued', application.paymentInstructionIssuedAt],
    ['Payment received', application.paymentReceivedOn],
    ['Shares allotted', application.allottedAt],
    ['Refunded', application.refundedAt],
    [application.status === 'withdrawn' ? 'Withdrawn' : 'Rejected', application.closedAt],
  ];
  return events.filter((event): event is [string, string] => Boolean(event[1]));
}

export function applicationAmount(quantity: string, price: string) {
  if (!/^[1-9]\d*$/.test(quantity) || !Number.isSafeInteger(Number(quantity)) || !/^\d+(\.\d{1,2})?$/.test(price))
    return null;
  const [whole, fraction = ''] = price.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents <= 0n) return null;
  const total = BigInt(quantity) * cents;
  return `${total / 100n}.${String(total % 100n).padStart(2, '0')}`;
}
