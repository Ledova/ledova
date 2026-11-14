export const COMPANY_STATUS_TONES = new Map<string, 'done' | 'moving' | 'waiting'>([
  ['active', 'done'],
  ['approved', 'done'],
  ['submitted', 'moving'],
  ['review', 'moving'],
  ['draft', 'waiting'],
  ['info_required', 'waiting'],
  ['warning', 'waiting'],
]);
