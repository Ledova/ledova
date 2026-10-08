import type { CompanyWalletInstruction, RegisterDecisionKind } from '../../types';

export const COMPANY_WALLET_UNMET_COPY: Record<string, string> = {
  appointment_capability_required: 'Your current personal appointment does not include this step.',
  approval_required: 'Approve this exact wallet instruction before applying it.',
  approval_lapsed: 'The original approval appointment ended.',
  already_approved: 'This instruction already has a current approval.',
  reason_required: 'Give a reason for rejection.',
  reason_not_allowed: 'Approval and application take no reason.',
  family_decided: 'This instruction has already been admitted or rejected.',
  wallet_proof_required: 'Refresh ordinary possession proof for this exact wallet.',
  wallet_source_changed: 'The original wallet or participant source changed.',
  eligibility_source_lapsed: 'The original company eligibility source is unavailable, expired or revoked.',
  wallet_not_owned: 'Select a wallet belonging to the participant account for this request.',
  base_wallet_required: 'Select an owned Base wallet.',
  registry_unavailable: 'The company registry could not be confirmed. Refresh before continuing.',
  whitelist_configuration_changed: 'The configured transaction no longer matches the original instruction.',
  whitelist_target_changed: 'The retained company approval target changed.',
  target_outcome_required: 'Select a genuine confirmed or unchanged ADD journal for removal.',
  expiry_required: 'Set a finite approval expiry.',
  expiry_exceeds_eligibility: 'Approval cannot outlast the selected company eligibility decision.',
  expiry_lapsed: 'The captured approval expiry has passed.',
  source_lock_busy: 'The original source is temporarily busy. Refresh its original outcome.',
};

export const COMPANY_WALLET_COPY = {
  STAGES: { submitted: 'Prepared', approved: 'Approved', applied: 'Admitted', rejected: 'Rejected' } as Record<
    string,
    string
  >,
  PREVIEW_FAILED: 'The wallet instruction could not be previewed. Refresh and try again.',
  DECIDE_FAILED: 'The response could not be confirmed. Recover the original wallet instruction receipt.',
  DECISION_RECEIPT_FAILED: 'The original wallet instruction decision could not be confirmed.',
  DECISIONS: {
    approve: 'Approve wallet instruction',
    apply: 'Apply wallet instruction',
    reject: 'Reject wallet instruction',
  } as Record<RegisterDecisionKind, string>,
  CONFIRMATIONS: {
    approve: 'Approve the exact company, selected wallet target, source, expiry and transaction intent shown.',
    apply:
      'Admit this exact approved instruction once for guarded execution. Admission does not confirm chain approval.',
    reject: 'Reject this wallet instruction with the reason given.',
  } as Record<RegisterDecisionKind, string>,
  REJECTION_REASON: 'Reason for rejection',
};

export function companyWalletExecutionState(record: CompanyWalletInstruction) {
  if (record.status !== 'applied') return 'Not admitted';
  const execution = record.execution;
  if (execution?.status === 'unchanged') return 'Observed unchanged; no transaction sent';
  if (execution?.operationStatus === 'reverted') return 'Original transaction reverted';
  if (execution?.status === 'failed' || execution?.operationStatus === 'failed') return 'Original execution failed';
  if (execution?.status === 'confirmed') return 'Original chain outcome confirmed and projected';
  if (execution?.operationStatus === 'confirmed') return 'Original chain outcome confirmed; projection pending';
  if (execution?.operationStatus === 'signed') return 'Original transaction signed; awaiting confirmation';
  if (record.executionUnmetRequirements.length) return 'Unsigned execution held';
  if (execution?.operationStatus === 'preparing') return 'Preparing original transaction';
  return 'Admitted; original execution pending';
}
