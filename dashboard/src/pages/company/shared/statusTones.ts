import type { CapitalIncreaseStatus } from '@ledova/shared';
import type { Tone } from '@components/Ledger';

export const SHARE_CLASS_STATUS_TONES = new Map<string, Tone>([
  ['deployed', 'done'],
  ['deploying', 'moving'],
]);

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
