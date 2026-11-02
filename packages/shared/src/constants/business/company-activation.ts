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

export function awaitsActivation(company: { status: string; activatedAt?: string | null }) {
  return !company.activatedAt && AWAITING_ACTIVATION.includes(company.status);
}
