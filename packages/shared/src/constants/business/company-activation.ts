import type { CompanyActivationAttempt } from '../../types';

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
  STEP: 'Verify and activate your company',
  CHECKS:
    'Activation checks the company against the Australian Business Register and, where required, your verified identity.',
};

export function awaitsActivation(company: { status: string; activatedAt?: string | null }) {
  return !company.activatedAt && AWAITING_ACTIVATION.includes(company.status);
}

const REASONS: Record<string, string> = {
  unconfigured: 'The ABR lookup is not configured.',
  unavailable: 'The ABR service is unavailable.',
  timeout: 'The ABR lookup timed out.',
  invalid_response: 'The ABR response could not be read.',
  provider_error: 'The ABR service returned an error.',
  incomplete_identity: 'Company identification is incomplete.',
  not_found: 'No matching ABR record was found.',
  identifier_mismatch: 'The ABR identifier does not match the company information.',
  cancelled: 'The ABR record is cancelled.',
  unknown_status: 'The ABR record status could not be confirmed.',
  name_mismatch: 'The ABR name does not match the company information.',
  unknown_entity_type: 'The ABR entity type could not be confirmed.',
  entity_type_mismatch: 'The ABR entity type does not match the company information.',
  matched: 'The ABR record matches the company information.',
};

export function companyActivationOutcome(attempt: CompanyActivationAttempt) {
  const result = attempt.appliedAt
    ? 'Activation was applied.'
    : attempt.status === 'pending'
      ? 'The activation check is pending. No activation was applied.'
      : 'No activation was applied.';
  return `${result} ${REASONS[attempt.reason] ?? 'The lookup outcome could not be confirmed.'}`;
}
