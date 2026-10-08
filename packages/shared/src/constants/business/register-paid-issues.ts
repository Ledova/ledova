export const REGISTER_PAID_ISSUE_COPY = {
  TITLE: 'Company paid issue decisions',
  NOTE: 'Choose an existing recorded paid subscription and retain exact company issue authority. Preparation and approval admit no mint; application admits the original issuance.',
  PROVIDED_BY_COMPANY: 'Issue authority, named director, reference and documentary evidence provided by the company.',
  PAYMENT_NOTE: 'These are existing recorded payment facts. They do not prove cleared funds or authorise issuance.',
  PREPARATION_RECEIPT_FAILED: 'The paid issue receipt could not be confirmed. Recover its identical original request.',
  PREVIEW_FAILED: 'The paid issue decision could not be previewed.',
  DECIDE_FAILED: 'The paid issue decision could not be confirmed.',
  DECISION_RECEIPT_FAILED: 'The receipt did not identify the original paid issue decision. Recover the same request.',
  REJECTION_REASON: 'Reason for rejection',
  DECISIONS: { approve: 'Approve', apply: 'Apply', reject: 'Reject' },
  CONFIRMATIONS: {
    approve:
      'Approve the exact subscription, recipient, whole quantity, recorded payment facts and company authority shown.',
    apply:
      'Admit this exact approved paid issue once. Its original finalised mint and register entry determine the outcome.',
    reject: 'Reject this issue proposal with the stated reason. This neither refunds nor rejects its subscription.',
  },
  STAGES: { submitted: 'Prepared', approved: 'Approved', applied: 'Applied', rejected: 'Rejected' },
  ADMITTED_NOTE:
    'Payment, company approval, original mint and register inclusion are separate. Source loss does not refund or release a bound paid allocation.',
} as const;

export const REGISTER_PAID_ISSUE_UNMET_COPY: Record<string, string> = {
  appointment_capability_required: 'Your current personal company appointment does not include this step.',
  company_not_active: 'The company must be active.',
  class_not_deployed: 'Use a supported deployed Base share class.',
  class_identity_changed: 'The exact company or class details changed after preparation.',
  subscription_not_paid: 'This subscription is not an existing recorded paid source.',
  subscription_already_admitted: 'This subscription already has an original issuance. Retain its original outcome.',
  subscription_source_changed: 'The captured subscription, recipient, quantity or recorded payment facts changed.',
  subscription_refunded: 'An actual refund changed this subscription before issue admission.',
  nothing_to_allot: 'The actual recorded allotment contains no shares.',
  insufficient_headroom: 'The exact allotment exceeds the offering or class headroom.',
  imported_register: 'This imported register is not supported for this chain issue.',
  approving_director_conflict: 'The company must name a director other than the actual recipient.',
  evidence_unavailable: 'The retained company authority evidence is unavailable.',
  evidence_changed: 'The retained company authority evidence changed.',
  company_provided_evidence_required: 'Retain authority evidence provided by the company.',
  approval_required: 'Approve the exact paid issue before applying it.',
  already_approved: 'This paid issue already has a current approval.',
  approval_lapsed: 'The original approval is no longer current.',
  reason_required: 'Give a reason for rejection.',
  reason_not_allowed: 'Approval and application take no rejection reason.',
  company_source_expired:
    'The original company issue authority no longer permits fresh signing. Its paid allocation remains bound.',
  legacy_source_unavailable: 'This historical unsigned issuance has no current company source.',
  source_lock_busy: 'The original source is temporarily busy. Its unsigned operation remains recoverable.',
};
