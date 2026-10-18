import type { Subscription } from '@ledova/shared';
import type { Tone } from './Ledger';

export const SUBSCRIPTION_TONES: Partial<Record<Subscription['status'], Tone>> = {
  draft: 'waiting',
  allotted: 'done',
  rejected: 'closed',
  withdrawn: 'closed',
  refunded: 'closed',
};

export function companySubscriptionTone(status: Subscription['status']): Tone {
  if (typeof status !== 'string' || !Object.prototype.hasOwnProperty.call(SUBSCRIPTION_TONES, status)) return 'waiting';
  return SUBSCRIPTION_TONES[status] ?? 'waiting';
}

export const RESOLUTION_RESULT_TONES = new Map<boolean, Tone>([
  [true, 'done'],
  [false, 'closed'],
]);
