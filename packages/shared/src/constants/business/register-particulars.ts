import type { RegisterDecisionKind } from '../../types';

export const REGISTER_PARTICULARS_UNMET_COPY: Record<string, string> = {
  appointment_capability_required: 'Your appointment does not include this step.',
  change_decided: 'This change has already been applied or rejected.',
  already_approved: 'This change already has a current approval.',
  approval_required: 'Approve this change before applying it.',
  approval_lapsed: "The approver's appointment has ended. Approve this change again before applying it.",
  evidence_unavailable:
    'The retained copy of the supporting document no longer matches its record. Prepare a new change.',
  member_left_retention:
    'This member has held no shares since the retention cutoff, so the register no longer keeps their particulars. ' +
    'Reject this change.',
  newer_particulars_exist:
    "The register now records this member's particulars as at a later date, from an import or another change, and " +
    'the latest date wins. Reject this change, and prepare a new one dated on or after that date if it still applies.',
  reason_required: 'Give a reason for the rejection.',
  reason_not_allowed: 'Approval and application take no reason.',
};

export const REGISTER_PARTICULARS_COPY = {
  TITLE: 'Particulars changes',
  EMPTY: 'No particulars change has been prepared for this company.',
  PREPARE: 'Change particulars',
  PROVIDED_BY_COMPANY: 'Provided by the company',
  READ_ONLY_NOTE:
    'You can read these changes. Preparing, approving and applying a particulars change needs an appointment with ' +
    'administration or that step.',
  PRECEDENCE_NOTE:
    "The latest as-at date wins between imported particulars and changes, and a member's live verified identity " +
    'still wins over both.',
  STAGES: {
    submitted: 'Prepared',
    approved: 'Approved',
    applied: 'Applied',
    rejected: 'Rejected',
  } as Record<string, string>,
  DECISIONS: { approve: 'Approve', apply: 'Apply', reject: 'Reject' } as Record<RegisterDecisionKind, string>,
  CONFIRMATIONS: {
    approve: 'Approve this change exactly as prepared.',
    apply: 'Apply this change now, recording its particulars for the member as at its date.',
    reject: 'Reject this change with the reason given.',
  } as Record<RegisterDecisionKind, string>,
  REJECTION_REASON: 'Reason for rejection',
  MEMBER: 'Member',
  UNNAMED_MEMBER: 'A member not named on the current register',
  CURRENT_PARTICULARS: 'Current particulars',
  NO_CURRENT_PARTICULARS: 'No particulars are recorded for this member yet.',
  PROPOSED_PARTICULARS: 'Proposed particulars',
  NAME: 'Name',
  RESIDENTIAL_ADDRESS: 'Residential address',
  AS_AT: 'As at',
  AS_AT_NOTE: 'The date the register records the change: today (UTC) or earlier.',
  REASON: 'Reason',
  SUPPORTING_DOCUMENT: 'Supporting document',
  SUPPORTING_DOCUMENT_NOTE:
    "A deed poll, the member's notice of a new address or another document that supports this change, provided by " +
    'the company. PDF or image, max 10 MB. Ledova does not verify it.',
  SUBMIT: 'Prepare change',
  DOWNLOAD: 'Download the supporting document',
  UPLOAD_RECEIPT_FAILED: 'The uploaded supporting document could not be confirmed. Upload it again.',
  PREPARATION_RECEIPT_FAILED:
    'The prepared change could not be confirmed. Check the particulars changes on Register before preparing again.',
  DECISION_RECEIPT_FAILED: 'The decision could not be confirmed. Refresh before retrying.',
  PREVIEW_FAILED: 'The decision could not be previewed. Refresh and try again.',
  DECIDE_FAILED: 'The decision was not recorded. Retry the same decision after refreshing.',
};
