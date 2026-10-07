import type { RegisterDecisionKind } from '../../types';

export const REGISTER_GRANT_UNMET_COPY: Record<string, string> = {
  appointment_capability_required: 'Your appointment does not include this step.',
  grant_decided: 'This grant has already been applied or rejected.',
  already_approved: 'This grant already has a current approval.',
  approval_required: 'Approve this grant before applying it.',
  approval_lapsed: "The approver's appointment has ended. Approve this grant again before applying it.",
  evidence_unavailable: 'A retained document no longer matches its record. Prepare a new grant.',
  company_provided_evidence_required: 'This grant must retain evidence provided by the company.',
  imported_non_tokenised_register_required:
    'This grant requires an opened, imported register for a draft share class without a deployed contract.',
  authorised_headroom_required: 'The grant exceeds the authorised share supply.',
  effective_date_before_latest_entry:
    'The register’s latest entry is dated after today. This grant cannot be recorded yet.',
  approving_director_conflict: 'The approving director is the recipient. Another director must approve the grant.',
  member_reference_conflict: 'The proposed new member already exists. Reject this grant and prepare a new one.',
  identified_company_member_required: 'The recipient must be an identified member of this company.',
  member_particulars_changed: 'The member particulars changed. Reject this grant and prepare a new one.',
  member_wallet_linked: 'This non-paid grant requires a member without linked wallets.',
  reason_required: 'Give a reason for the rejection.',
  reason_not_allowed: 'Approval and application take no reason.',
};

export const REGISTER_GRANT_COPY = {
  TITLE: 'Non-paid grants',
  PREPARE: 'Prepare a non-paid grant',
  SUBMIT: 'Prepare grant',
  EMPTY: 'No non-paid grant has been prepared for this share class.',
  NOTE: 'Record a non-paid issue to a walletless member of an imported register for a draft share class, with the company’s terms and authority.',
  READ_ONLY_NOTE: 'Preparing, approving and applying a grant needs current company administration or that step.',
  NAME: 'Name',
  RESIDENTIAL_ADDRESS: 'Residential address',
  SHARES: 'Shares to grant',
  TERMS_ON: 'Terms dated on',
  DIRECTOR: 'Approving director',
  DIRECTOR_NOTE:
    'The company supplies the approving director’s name. This director must be someone other than the recipient.',
  EFFECTIVE_NOTE:
    'Application records the ISSUE entry on the actual day it is made (UTC). The company’s terms date is retained separately.',
  TERMS: 'Non-paid grant terms',
  AUTHORITY_REFERENCE: 'Company authority reference',
  REASON: 'Reason for grant',
  AUTHORITY_DOCUMENT: 'Authority document',
  TERMS_DOCUMENT: 'Terms document',
  ACCEPTANCE_DOCUMENT: 'Acceptance document',
  ACCEPTANCE_REQUIRED: 'The terms require recipient acceptance',
  PROVIDED_BY_COMPANY: 'Terms, approving director, authority and particulars are provided by the company.',
  RECOVERY_NOTE:
    'If a decision response is interrupted, refresh grants to read its recorded outcome before starting another decision.',
  STAGES: { submitted: 'Prepared', approved: 'Approved', applied: 'Applied', rejected: 'Rejected' } as Record<
    string,
    string
  >,
  DECISIONS: { approve: 'Approve', apply: 'Apply', reject: 'Reject' } as Record<RegisterDecisionKind, string>,
  CONFIRMATIONS: {
    approve:
      'Approve the exact member, terms date, approving director, evidence, shares and actual register entry date shown.',
    apply: 'Record this authorised non-paid grant once, increasing the member’s holding and issued supply.',
    reject: 'Reject this grant with the reason given.',
  } as Record<RegisterDecisionKind, string>,
  REJECTION_REASON: 'Reason for rejection',
  PREPARATION_RECEIPT_FAILED: 'The prepared grant could not be confirmed. Check the register before preparing again.',
  DECISION_RECEIPT_FAILED: 'The decision could not be confirmed. Refresh before retrying.',
  PREVIEW_FAILED: 'The decision could not be previewed. Refresh and try again.',
  DECIDE_FAILED: 'The decision response could not be confirmed. Refresh grants to read the outcome before retrying.',
};
