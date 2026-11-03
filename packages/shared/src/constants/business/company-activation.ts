const AWAITING_ACTIVATION: readonly string[] = [
  'draft',
  'submitted',
  'review',
  'info_required',
  'approved',
  'rejected',
  'withdrawn',
];

export const COMPANY_ACTIVATION_COPY = {
  STEP: 'Activate your company',
  NOTE: 'Activation records your declaration and, where required, your verified identity.',
};

export const COMPANY_STATUS_TONES = new Map<string, 'done' | 'moving' | 'waiting'>([
  ['active', 'done'],
  ['approved', 'done'],
  ['submitted', 'moving'],
  ['review', 'moving'],
  ['draft', 'waiting'],
  ['info_required', 'waiting'],
  ['warning', 'waiting'],
]);

export function awaitsActivation(company: { status: string; activatedAt?: string | null }) {
  return !company.activatedAt && AWAITING_ACTIVATION.includes(company.status);
}
