import type { Tone } from '@components/Ledger';

export const DIRECTORY_OFFERING_TONES = new Map<boolean, Tone>([
  [true, 'moving'],
  [false, 'waiting'],
]);
