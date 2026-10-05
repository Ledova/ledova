import type { RegisterImportDecisionKind } from '../../types';

export const REGISTER_IMPORT_UNMET_COPY: Record<string, string> = {
  appointment_capability_required: 'Your appointment does not include this step.',
  import_decided: 'This import has already been applied or rejected.',
  company_provided_evidence_required:
    'This import was submitted for the retired staff review. It can only be rejected; prepare a new import instead.',
  already_approved: 'This import already has a current approval.',
  approval_required: 'Approve this import before applying it.',
  approval_lapsed: "The approver's appointment has ended. Approve this import again before applying it.",
  evidence_unavailable: 'A retained evidence copy no longer matches its record. Prepare a new import.',
  class_has_applied_import: 'This share class already has an applied import.',
  class_not_openable:
    'An issue was approved or a register instruction applied for this class, so an import can no longer open it. ' +
    'Open it from the chain, then import its particulars.',
  holdings_differ:
    "The import's holdings differ from the stored register. Reject it and prepare one as at the stored holdings.",
  former_member_after_opening: 'A former member ceased on or after the register was opened.',
  former_member_before_retention: 'A former member ceased before the seven-year retention period.',
  reason_required: 'Give a reason for the rejection.',
  reason_not_allowed: 'Approval and application take no reason.',
};

export const REGISTER_IMPORT_COPY = {
  TITLE: 'Imports',
  EMPTY: 'No import has been prepared for this share class.',
  PREPARE: 'Prepare an import',
  PROVIDED_BY_COMPANY: 'Provided by the company',
  STAFF_VERIFIED: 'Verified by Ledova staff before imports were company-run',
  READ_ONLY_NOTE:
    'You can read these imports. Preparing, approving and applying an import needs an appointment with ' +
    'administration or that step.',
  NO_HOLDERS: 'The stored register lists no current members, so this class has none to import.',
  NOT_ON_CHAIN_NOTE:
    "Applying this import opens the share class's register from the company's own records. A class an import " +
    'opened is not on chain: it records no issue, transfer or cessation until it is tokenised, which is later work.',
  STAGES: {
    submitted: 'Prepared',
    approved: 'Approved',
    applied: 'Applied',
    rejected: 'Rejected',
  } as Record<string, string>,
  DECISIONS: { approve: 'Approve', apply: 'Apply', reject: 'Reject' } as Record<RegisterImportDecisionKind, string>,
  CONFIRMATIONS: {
    approve: 'Approve this import exactly as prepared.',
    apply: 'Apply this import to the register now. This cannot be undone.',
    reject: 'Reject this import with the reason given.',
  } as Record<RegisterImportDecisionKind, string>,
  REJECTION_REASON: 'Reason for rejection',
  STATED_FIGURES: (total: string, count: number) =>
    `ASIC extract, as stated by the company: ${total} shares held by ${count} ${count === 1 ? 'member' : 'members'}`,
  IMPORTED_FIGURES: (total: string, count: number) =>
    `Import rows: ${total} shares held by ${count} ${count === 1 ? 'member' : 'members'}`,
  DOWNLOAD_REGISTER: 'Download the register document',
  DOWNLOAD_ASIC: 'Download the ASIC extract',
  DECISION_RECEIPT_FAILED: 'The decision could not be confirmed. Refresh before retrying.',
  PREPARATION_RECEIPT_FAILED:
    'The prepared import could not be confirmed. Check the imports on Register before preparing again.',
  UPLOAD_RECEIPT_FAILED: 'The uploaded evidence could not be confirmed. Upload it again.',
  PREVIEW_FAILED: 'The decision could not be previewed. Refresh and try again.',
  DECIDE_FAILED: 'The decision was not recorded. Retry the same decision after refreshing.',
};
