import type { Tone } from './Ledger';

export const RESOLUTION_RESULT_TONES = new Map<boolean, Tone>([
  [true, 'done'],
  [false, 'closed'],
]);
