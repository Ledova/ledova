export const REGISTER_CAPITAL_INCREASE_COPY = {
  TITLE: 'Company capital increases',
  NOTE: 'Increase the authorised cap with company terms and authority. This mints zero shares, changes no holding and records no payment.',
  PROVIDED_BY_COMPANY: 'Purpose, references and documentary authority provided by the company.',
  PREPARATION_RECEIPT_FAILED: 'The capital receipt could not be confirmed. Recover its identical original request.',
  PREVIEW_FAILED: 'The capital decision could not be previewed.',
  DECIDE_FAILED: 'The capital decision could not be confirmed.',
  DECISION_RECEIPT_FAILED:
    'The decision receipt did not identify the original capital increase. Recover the same request.',
  REJECTION_REASON: 'Reason for rejection',
  DECISIONS: { approve: 'Approve', apply: 'Apply', reject: 'Reject' },
  CONFIRMATIONS: {
    approve: 'Approve the exact captured cap, increase, target, purpose, references and company evidence shown.',
    apply:
      'Admit this exact approved cap increase for execution once. The cap changes only after its genuine original transaction and finality.',
    reject: 'Reject this capital increase with the stated reason.',
  },
  STAGES: { submitted: 'Prepared', approved: 'Approved', applied: 'Applied', rejected: 'Rejected' },
  ADMITTED_NOTE:
    'Application admits the original capital execution. A matching current cap alone does not prove its original transaction or finality.',
} as const;

export const REGISTER_CAPITAL_INCREASE_UNMET_COPY: Record<string, string> = {
  appointment_capability_required: 'Your current personal company appointment does not include this step.',
  company_not_active: 'The company must be active.',
  class_not_deployed: 'Use a supported deployed or paused Base class.',
  class_identity_changed: 'The class or chain configuration changed after preparation.',
  capital_terms_changed: 'The exact captured capital terms changed. Prepare a new increase.',
  capital_configuration_changed:
    'The retained chain or signer configuration changed. Refresh the exact capital source.',
  capital_in_flight: 'Resolve the original class capital execution before preparing another increase.',
  authorised_cap_unavailable: 'The genuine chain cap could not be read. Refresh before a fresh decision.',
  evidence_changed: 'The retained company authority evidence changed.',
  authorised_cap_changed: 'The captured authorised cap changed. Prepare a new exact increase.',
  evidence_unavailable: 'The retained company authority evidence is unavailable.',
  company_provided_evidence_required: 'Retain authority evidence provided by the company.',
  approval_required: 'Approve the exact capital increase before applying it.',
  already_approved: 'This capital increase already has a current approval.',
  approval_lapsed: 'The original approval is no longer current.',
  reason_required: 'Give a reason for rejection.',
  reason_not_allowed: 'Approval and application take no reason.',
  company_source_expired: 'The original company capital authority is no longer current for fresh signing.',
  legacy_source_unavailable: 'This historical unsigned operation has no current company source.',
  source_lock_busy: 'The original source is temporarily busy. Its unsigned operation remains recoverable.',
};
