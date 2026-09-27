import { formatShareCount } from '@ledova/shared';
import type { Subscription } from '@ledova/shared';
import type { Tone } from '@components/Ledger';

const STATES: Record<string, { words: string; tone: Tone }> = {
  draft: { words: 'Draft', tone: 'waiting' },
  submitted: { words: 'Under review by the operator', tone: 'moving' },
  accepted: { words: 'Accepted, payment instruction next', tone: 'moving' },
  awaiting_payment: { words: 'Awaiting your payment', tone: 'moving' },
  paid: { words: 'Payment received, allotment next', tone: 'moving' },
  allotted: { words: 'Shares allotted', tone: 'done' },
  rejected: { words: 'Rejected', tone: 'closed' },
  withdrawn: { words: 'Withdrawn', tone: 'closed' },
  refunded: { words: 'Refunded', tone: 'closed' },
};

export function applicationState(application: Pick<Subscription, 'status' | 'statusDisplay'>) {
  return STATES[application.status] ?? { words: application.statusDisplay, tone: 'moving' as Tone };
}

export function applicationShares(quantity: number) {
  return Number.isSafeInteger(quantity) && quantity >= 0 ? formatShareCount(String(quantity)) : 'Unavailable';
}
