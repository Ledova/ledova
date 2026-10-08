export const REGISTER_PAUSE_CHANGE_COPY = {
  TITLE: 'Company pause decisions',
  NOTE: 'Record the requested pause state with company authority. Preparation and approval change no class state; application admits the original execution.',
  PROVIDED_BY_COMPANY: 'Reason, reference and documentary authority provided by the company.',
  PREPARATION_RECEIPT_FAILED: 'The pause receipt could not be confirmed. Recover its identical original request.',
  PREVIEW_FAILED: 'The pause decision could not be previewed.',
  DECIDE_FAILED: 'The pause decision could not be confirmed.',
  DECISION_RECEIPT_FAILED: 'The decision receipt did not identify the original pause change. Recover the same request.',
  REJECTION_REASON: 'Reason for rejection',
  DECISIONS: { approve: 'Approve', apply: 'Apply', reject: 'Reject' },
  CONFIRMATIONS: {
    approve: 'Approve the exact requested state, reason, reference and company authority shown.',
    apply:
      'Admit this exact approved pause change once. Its original observation or finalised transaction determines the outcome.',
    reject: 'Reject this pause change with the stated reason.',
  },
  STAGES: { submitted: 'Prepared', approved: 'Approved', applied: 'Applied', rejected: 'Rejected' },
  ADMITTED_NOTE:
    'The original requested state and outcome remain separate from the current class state. A matching current state alone does not prove an original transaction.',
} as const;

export const REGISTER_PAUSE_CHANGE_UNMET_COPY: Record<string, string> = {
  appointment_capability_required: 'Your current personal company appointment does not include this step.',
  company_not_active: 'The company must be active.',
  class_not_deployed: 'Use a supported deployed or paused Base class.',
  class_identity_changed: 'The exact company or class details changed after preparation.',
  pause_configuration_changed: 'The retained chain or signer configuration changed. Refresh the exact pause source.',
  evidence_changed: 'The retained company authority evidence changed.',
  evidence_unavailable: 'The retained company authority evidence is unavailable.',
  company_provided_evidence_required: 'Retain authority evidence provided by the company.',
  approval_required: 'Approve the exact pause change before applying it.',
  already_approved: 'This pause change already has a current approval.',
  approval_lapsed: 'The original approval is no longer current.',
  reason_required: 'Give a reason for rejection.',
  reason_not_allowed: 'Approval and application take no rejection reason.',
  company_source_expired: 'The original company pause authority is no longer current for fresh signing.',
  legacy_source_unavailable: 'This historical unsigned operation has no current company source.',
  source_lock_busy: 'The original source is temporarily busy. Its unsigned operation remains recoverable.',
};
