import type { RegisterCorrectionAuthority, RegisterDecisionKind, RegisterEntryKind } from '../../types';

export const REGISTER_CORRECTION_UNMET_COPY: Record<string, string> = {
  appointment_capability_required: 'Your appointment does not include this step.',
  correction_decided: 'This correction has already been applied or rejected.',
  company_provided_evidence_required:
    'This correction was submitted for the retired staff review. It can only be rejected; prepare a new correction ' +
    'instead.',
  already_approved: 'This correction already has a current approval.',
  approval_required: 'Approve this correction before applying it.',
  approval_lapsed: "The approver's appointment has ended. Approve this correction again before applying it.",
  evidence_unavailable:
    'The retained copy of the authority document no longer matches its record. Prepare a new correction.',
  register_changed:
    'The register has a newer entry than the one this correction was prepared against. Reject it and prepare a new ' +
    'one against the current register.',
  entry_already_corrected: 'Another correction of this entry has been applied. Reject this one.',
  position_would_go_negative:
    "Applying this correction would take a member's holding below zero. Reject it and review the current register.",
  reason_required: 'Give a reason for the rejection.',
  reason_not_allowed: 'Approval and application take no reason.',
};

export const REGISTER_CORRECTION_COPY = {
  TITLE: 'Corrections',
  EMPTY: 'No correction has been prepared for this share class.',
  ENTRIES_TITLE: 'Register entries',
  ENTRIES_EMPTY: 'The register of this share class has no entries yet.',
  PREPARE: 'Correct this entry',
  PROVIDED_BY_COMPANY: 'Provided by the company',
  STAFF_VERIFIED: 'Verified by Ledova staff before corrections were company-run',
  READ_ONLY_NOTE:
    'You can read these corrections. Preparing, approving and applying a correction needs an appointment with ' +
    'administration or that step.',
  COMPENSATION_NOTE:
    'A correction reverses one entry exactly with a new compensating entry. The original entry stays in the ' +
    'register, and nothing changes on chain.',
  CORRECTED_NOTE: 'A correction has reversed this entry.',
  STAGES: {
    submitted: 'Prepared',
    approved: 'Approved',
    applied: 'Applied',
    rejected: 'Rejected',
  } as Record<string, string>,
  DECISIONS: { approve: 'Approve', apply: 'Apply', reject: 'Reject' } as Record<RegisterDecisionKind, string>,
  CONFIRMATIONS: {
    approve: 'Approve this correction exactly as prepared.',
    apply: 'Apply this correction to the register now. This cannot be undone.',
    reject: 'Reject this correction with the reason given.',
  } as Record<RegisterDecisionKind, string>,
  REJECTION_REASON: 'Reason for rejection',
  ENTRY_KINDS: {
    opening: 'Opening state',
    issue: 'Issue',
    transfer: 'Transfer',
    cessation: 'Cessation',
    correction: 'Compensating correction',
  } as Record<RegisterEntryKind, string>,
  ORIGINAL_CHANGES: 'Entry being corrected',
  COMPENSATING_CHANGES: 'Compensating changes',
  UNNAMED_MEMBER: (member: string) => `Member ${member}`,
  AUTHORITY_DOCUMENT: 'Authority document',
  AUTHORITY_DOCUMENT_NOTE:
    'The director resolution or court order that authorises this correction, provided by the company. PDF or ' +
    'image, max 10 MB. Ledova does not verify it.',
  EFFECTIVE_ON: 'Effective date',
  EFFECTIVE_ON_NOTE: 'Today (UTC) or earlier. A correction can be backdated, but cannot take effect later.',
  AUTHORITY: 'Authority',
  AUTHORITIES: {
    director_resolution: 'Director resolution',
    court_order: 'Court order',
  } as Record<RegisterCorrectionAuthority, string>,
  APPROVING_DIRECTOR: 'Approving director',
  AUTHORITY_REFERENCE: 'Authority reference',
  REASON: 'Reason',
  SUBMIT: 'Prepare correction',
  DOWNLOAD: 'Download the authority document',
  CHANGES_UNREADABLE: 'The register correction changes could not be read.',
  UPLOAD_RECEIPT_FAILED: 'The uploaded authority document could not be confirmed. Upload it again.',
  PREPARATION_RECEIPT_FAILED:
    'The prepared correction could not be confirmed. Check the corrections on Register before preparing again.',
  DECISION_RECEIPT_FAILED: 'The decision could not be confirmed. Refresh before retrying.',
  PREVIEW_FAILED: 'The decision could not be previewed. Refresh and try again.',
  DECIDE_FAILED: 'The decision was not recorded. Retry the same decision after refreshing.',
};
