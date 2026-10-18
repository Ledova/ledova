import { SUBSCRIPTION_STATUS_LABELS, formatShareCount } from '@ledova/shared';
import type { Subscription } from '@ledova/shared';
import type { Tone } from '@components/Ledger';

const TONES: Partial<Record<Subscription['status'], Tone>> = {
  draft: 'waiting',
  allotted: 'done',
  rejected: 'closed',
  withdrawn: 'closed',
  refunded: 'closed',
};

export function applicationState(application: Pick<Subscription, 'status' | 'statusDisplay'>) {
  return {
    words: SUBSCRIPTION_STATUS_LABELS[application.status] ?? application.statusDisplay,
    tone: TONES[application.status] ?? ('moving' as Tone),
  };
}

export function applicationShares(quantity: number) {
  return Number.isSafeInteger(quantity) && quantity >= 0 ? formatShareCount(String(quantity)) : 'Unavailable';
}
