import type { CapitalIncreaseStatus, OfferingListItem } from '@ledova/shared';
import type { Tone } from '@components/Ledger';

export const SHARE_CLASS_STATUS_TONES = new Map<string, Tone>([
  ['deployed', 'done'],
  ['deploying', 'moving'],
]);

const OFFERING_STATUS_TONES = new Map<string, Tone>([
  ['submitted', 'moving'],
  ['under_review', 'moving'],
  ['approved', 'moving'],
  ['draft', 'waiting'],
]);

export function offeringTone(offering: Pick<OfferingListItem, 'isOpen' | 'status'>): Tone {
  return offering.isOpen ? 'done' : (OFFERING_STATUS_TONES.get(offering.status) ?? 'closed');
}

export const AUTHORITY_REQUEST_TONES = new Map<string, Tone>([['pending', 'waiting']]);

const CAPITAL_REQUEST_TONES = new Map<string, Tone>([
  ['executed', 'done'],
  ['submitted', 'moving'],
  ['under_review', 'moving'],
  ['approved', 'moving'],
  ['executing', 'moving'],
  ['draft', 'waiting'],
]);

export function requestTone(status: CapitalIncreaseStatus): Tone {
  return CAPITAL_REQUEST_TONES.get(status) ?? 'closed';
}
