import type { RegisterDecisionKind } from '../../types';

export const REGISTER_ALLOTMENT_COPY = {
  TITLE: 'External investor allotments',
  PREPARE: 'Prepare an external allotment',
  SUBMIT: 'Prepare allotment',
  EMPTY: 'No external allotment has been prepared for this share class.',
  NOTE: 'Record a fully paid external investment for a walletless member of an opened imported register. The agreement and company-recorded receipt do not approve or issue shares.',
  RECEIPT_NOTE: 'Receipt is attested by the company. Ledova has not verified or collected this money.',
  READ_ONLY_NOTE: 'Preparation, approval and application each require current company authority for that step.',
  SHARES: 'Shares to allot',
  CONSIDERATION: 'Full consideration (AUD)',
  RECEIVED_AMOUNT: 'Company-reported amount received (AUD)',
  RECEIVED_ON: 'Company-reported receipt date',
  AGREEMENT_REFERENCE: 'External agreement reference',
  AGREEMENT_ON: 'Agreement dated on',
  TERMS: 'External agreement terms',
  DIRECTOR: 'Approving director',
  AUTHORITY_REFERENCE: 'Company authority reference',
  REASON: 'Reason for allotment',
  DOCUMENTS: { authority: 'Authority document', agreement: 'Agreement document', receipt: 'Receipt evidence' },
  EFFECTIVE_NOTE:
    'The register ISSUE is dated on the actual application day (UTC). Agreement and receipt dates are retained separately.',
  RECOVERY_NOTE: 'If a response is interrupted, recover the same request before starting another allotment.',
  STAGES: { submitted: 'Prepared', approved: 'Approved', applied: 'Applied', rejected: 'Rejected' } as Record<
    string,
    string
  >,
  DECISIONS: { approve: 'Approve', apply: 'Apply', reject: 'Reject' } as Record<RegisterDecisionKind, string>,
  CONFIRMATIONS: {
    approve:
      'Approve this exact member, class, whole quantity, AUD consideration, company-recorded receipt, agreement and company instruction.',
    apply:
      'Apply the approved fully paid allotment once, recording the ISSUE and increasing the member’s holding and issued supply.',
    reject: 'Reject this allotment. Its agreement and company receipt remain recorded; no refund is performed.',
  } as Record<RegisterDecisionKind, string>,
  REJECTION_REASON: 'Reason for rejection',
  PREPARATION_RECEIPT_FAILED:
    'The allotment response could not be confirmed. Recover the same request before preparing another.',
  PREVIEW_FAILED: 'The allotment decision could not be previewed. Refresh and try again.',
  DECIDE_FAILED:
    'The decision response could not be confirmed. Recover its original receipt before starting another decision.',
  DECISION_RECEIPT_FAILED: 'The allotment decision receipt does not match the confirmed instruction.',
};

export const REGISTER_ALLOTMENT_UNMET_COPY: Record<string, string> = {
  appointment_capability_required: 'Your appointment does not include this step.',
  allotment_decided: 'This allotment has already been applied or rejected.',
  already_approved: 'This allotment already has a current approval.',
  approval_required: 'Approve this allotment before applying it.',
  approval_lapsed: 'The approver’s appointment has ended. Approve this allotment again before applying it.',
  evidence_unavailable: 'The retained evidence no longer matches its record.',
  company_provided_evidence_required: 'Agreement, receipt and authority evidence must be provided by the company.',
  imported_non_tokenised_register_required:
    'This requires an opened imported register for a draft class without a deployed contract.',
  authorised_headroom_required: 'This allotment exceeds the authorised share supply.',
  effective_date_before_latest_entry: 'The latest register entry is dated after today.',
  approving_director_conflict: 'The recipient cannot be the approving director.',
  member_reference_conflict: 'This new member already exists. Prepare a new instruction.',
  identified_company_member_required: 'Select an identified member of this company.',
  member_particulars_changed: 'Member particulars changed. Prepare a new instruction.',
  member_wallet_linked: 'This allotment requires a walletless member.',
  fully_paid_company_receipt_required: 'The company-recorded receipt must equal the full AUD consideration.',
  reason_required: 'Give a reason for rejection.',
  reason_not_allowed: 'Approval and application take no reason.',
};
