import type { RegisterDecisionKind } from '../../types';

export const REGISTER_TRANSFER_UNMET_COPY: Record<string, string> = {
  appointment_capability_required: 'Your appointment does not include this step.',
  transfer_decided: 'This transfer has already been applied or rejected.',
  already_approved: 'This transfer already has a current approval.',
  approval_required: 'Approve this transfer before applying it.',
  approval_lapsed: 'The approving appointment has ended. Approve the transfer again before applying it.',
  evidence_unavailable: 'A retained document no longer matches its record. Prepare a new transfer.',
  company_provided_evidence_required: 'This transfer must retain the company’s evidence.',
  imported_non_tokenised_register_required:
    'This transfer requires an imported register for a draft share class without a deployed contract.',
  sufficient_holding_required: 'The transferor no longer holds enough shares for this transfer.',
  share_limit_required: 'The recipient holding exceeds the supported share limit.',
  effective_date_before_latest_entry:
    'The register’s latest entry is dated after today. This transfer cannot be recorded yet.',
  identified_company_member_required: 'Both parties must be identified members of this company.',
  member_particulars_changed: 'A party’s particulars changed. Reject this transfer and prepare a new one.',
  member_reference_conflict:
    'The proposed new recipient already exists. Prepare a transfer to their existing member ID.',
  member_wallet_linked: 'Both parties must have no linked wallet in this company for this transfer.',
  director_is_party: 'The approving director is a party to the transfer. Another director must approve it.',
  reason_required: 'Give a reason for rejection.',
  reason_not_allowed: 'Approval and application take no reason.',
};

export const REGISTER_TRANSFER_COPY = {
  TITLE: 'Non-paid transfers',
  PREPARE: 'Prepare a non-paid transfer',
  SUBMIT: 'Prepare transfer',
  EMPTY: 'No non-paid transfer has been prepared for this share class.',
  NOTE: 'Transfer shares between walletless members of an imported draft register, under the company’s authority and a genuine signed instrument.',
  READ_ONLY_NOTE: 'Preparing, approving and applying a transfer needs current company administration or that step.',
  FROM: 'Transferor',
  TO: 'Recipient',
  NAME: 'Recipient name',
  ADDRESS: 'Recipient residential address',
  SHARES: 'Shares to transfer',
  SIGNED_ON: 'Instrument signed on',
  LODGED_ON: 'Instrument lodged with the company on',
  TERMS: 'Non-paid transfer terms',
  DIRECTOR: 'Approving director',
  DIRECTOR_NOTE: 'The approving director must be someone other than either party to the transfer.',
  AUTHORITY_REFERENCE: 'Company authority reference',
  REASON: 'Reason for transfer',
  AUTHORITY_DOCUMENT: 'Authority document',
  INSTRUMENT_DOCUMENT: 'Signed transfer instrument',
  PROVIDED_BY_COMPANY: 'The instrument, authority, terms and particulars are provided by the company.',
  RECOVERY_NOTE:
    'If a decision response is interrupted, refresh transfers to read its recorded outcome before retrying.',
  EFFECTIVE_NOTE:
    'Application records the transfer on the actual day the register entry is made (UTC). Signing and lodgement keep their own dates.',
  STAGES: { submitted: 'Prepared', approved: 'Approved', applied: 'Applied', rejected: 'Rejected' } as Record<
    string,
    string
  >,
  DECISIONS: { approve: 'Approve', apply: 'Apply', reject: 'Reject' } as Record<RegisterDecisionKind, string>,
  CONFIRMATIONS: {
    approve: 'Approve the exact parties, shares, instrument, dates and company authority shown.',
    apply: 'Record the authorised transfer once, moving shares between these members and preserving issued supply.',
    reject: 'Reject this transfer with the reason given.',
  } as Record<RegisterDecisionKind, string>,
  REJECTION_REASON: 'Reason for rejection',
  PREPARATION_RECEIPT_FAILED:
    'The prepared transfer could not be confirmed. Check the register before preparing again.',
  DECISION_RECEIPT_FAILED: 'The decision could not be confirmed. Refresh transfers before retrying.',
  PREVIEW_FAILED: 'The decision could not be previewed. Refresh and try again.',
  DECIDE_FAILED: 'The decision response could not be confirmed. Refresh transfers to read the outcome before retrying.',
};
