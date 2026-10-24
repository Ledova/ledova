import type { RegisterDecisionKind } from '../../types';

export const REGISTER_GRANT_UNMET_COPY: Record<string, string> = {
  appointment_capability_required: 'Your appointment does not include this step.',
  grant_decided: 'This grant has already been applied or rejected.',
  already_approved: 'This grant already has a current approval.',
  approval_required: 'Approve this grant before applying it.',
  approval_lapsed: 'This approval is no longer current. Approve this grant again before applying it.',
  award_chronology_changed:
    'The issue date is before a later accepted award event or known issue. Reject this preparation and prepare it again with the company’s correct date.',
  evidence_unavailable: 'A retained document no longer matches its record. Prepare a new grant.',
  award_binding_required:
    'This grant no longer matches its employee award. Reject it and prepare a new grant from the award.',
  recorded_vested_quantity_required:
    'The grant exceeds the award’s recorded vested shares not yet issued or ended. Record the vesting first, or ' +
    'reject this grant.',
  award_evidence_unavailable: 'A retained award agreement or event document no longer matches its record.',
  company_provided_evidence_required: 'This grant must retain evidence provided by the company.',
  imported_non_tokenised_register_required:
    'This grant requires an opened, imported register for a draft share class without a deployed contract.',
  authorised_headroom_required: 'The grant exceeds the authorised share supply.',
  company_event_date_required:
    'The company event date was not recorded. Reject this preparation and prepare it again with the company’s date.',
  company_event_date_in_future: 'The company event date cannot be after today (UTC).',
  effective_date_before_latest_entry:
    'The company event date is before a later register event. Use the company’s correction or reconciliation process.',
  approving_director_conflict: 'The approving director is the recipient. Another director must approve the grant.',
  member_reference_conflict: 'The proposed new member already exists. Reject this grant and prepare a new one.',
  identified_company_member_required: 'The recipient must be an identified member of this company.',
  member_particulars_changed: 'The member particulars changed. Reject this grant and prepare a new one.',
  member_wallet_linked: 'This non-paid grant requires a member without linked wallets.',
  reason_required: 'Give a reason for the rejection.',
  reason_not_allowed: 'Approval and application take no reason.',
};

export const REGISTER_GRANT_COPY = {
  SUBMIT: 'Prepare grant',
  NOTE: 'Record a non-paid issue to a walletless member of an imported register for a draft share class, with the company’s terms and authority.',
  READ_ONLY_NOTE: 'Preparing, approving and applying a grant needs current company administration or that step.',
  RESIDENTIAL_ADDRESS: 'Residential address',
  SHARES: 'Shares to grant',
  TERMS_ON: 'Terms dated on',
  DIRECTOR: 'Approving director',
  COMPANY_EVENT_ON: 'Company issue date',
  TERMS: 'Non-paid grant terms',
  AUTHORITY_REFERENCE: 'Company authority reference',
  REASON: 'Reason for grant',
  AUTHORITY_DOCUMENT: 'Authority document',
  TERMS_DOCUMENT: 'Terms document',
  ACCEPTANCE_DOCUMENT: 'Acceptance document',
  ACCEPTANCE_REQUIRED: 'The terms require recipient acceptance',
  PROVIDED_BY_COMPANY: 'Terms, approving director, authority and particulars are provided by the company.',
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
