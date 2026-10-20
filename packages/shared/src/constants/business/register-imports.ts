import type { RegisterDecisionKind } from '../../types';

export const REGISTER_IMPORT_UNMET_COPY: Record<string, string> = {
  appointment_capability_required: 'Your appointment does not include this step.',
  import_decided: 'This import has already been applied or rejected.',
  company_provided_evidence_required:
    'This import was submitted for the retired staff review. It can only be rejected; prepare a new import instead.',
  already_approved: 'This import already has a current approval.',
  approval_required: 'Review these records before confirming the mirror.',
  approval_lapsed: 'The reviewer’s appointment has ended. Review these records again before confirming the mirror.',
  evidence_unavailable: 'A retained evidence copy no longer matches its record. Prepare a new import.',
  class_has_applied_import: 'This share class already has an applied import.',
  empty_non_tokenised_opening_required:
    'An empty opening needs an unopened class without a contract or former members. It cannot erase an existing register.',
  mirror_snapshot_changed: 'These records are no longer the latest confirmed snapshot. Refresh before correcting them.',
  register_changed: 'The stored ownership has changed since this correction was prepared. Refresh before continuing.',
  mirror_correction_activity: 'This class has later activity. An opening correction cannot change it.',
  mirror_correction_member_activity:
    'Member access or particulars have changed since setup. An opening correction cannot change those records.',
  deployment_pending: 'A share-class deployment is pending. Wait for its outcome before changing the mirror.',
  award_recipient_identity_changed:
    'An award recipient in these records no longer matches the company’s award records. Reject this import and ' +
    'prepare a new one.',
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
  SETUP: 'Set up your share register',
  SETUP_NOTE: "Bring in the company's existing share records. This doesn't wait for activation.",
  TITLE: 'Register mirror',
  EMPTY: 'Bring in the company’s existing records for this share class.',
  PREPARE: 'Bring records',
  CORRECT: 'Correct opening records',
  MIRROR_NOTE:
    'Ledova mirrors the company’s existing share register. The company keeps its legal register, historical records, ' +
    'lawful access arrangements and filings as before.',
  PROVIDED_BY_COMPANY: 'Provided by the company',
  STAFF_VERIFIED: 'Verified by Ledova staff before imports were company-run',
  READ_ONLY_NOTE:
    'You can read these records. Bringing, reviewing and confirming records needs the company appointment for that step.',
  NO_HOLDERS: 'The stored register lists no current members, so this class has none to import.',
  NOT_ON_CHAIN_NOTE:
    'Confirming records mirrors shares the company has already issued. It does not issue shares, replace its legal ' +
    'register or require shareholder accounts or wallets.',
  STAGES: {
    submitted: 'Prepared',
    approved: 'Reviewed',
    applied: 'Confirmed',
    rejected: 'Rejected',
  } as Record<string, string>,
  DECISIONS: { approve: 'Review', apply: 'Confirm mirror', reject: 'Reject' } as Record<RegisterDecisionKind, string>,
  CONFIRMATIONS: {
    approve: 'Review these company-provided records exactly as prepared.',
    apply: 'Confirm this exact mirror of the company’s existing register. Earlier snapshots remain retained.',
    reject: 'Reject this import with the reason given.',
  } as Record<RegisterDecisionKind, string>,
  REJECTION_REASON: 'Reason for rejection',
  STATED_FIGURES: (total: string, count: number) =>
    `Optional ASIC cross-check: ${total} issued shares; ${count} listed ${count === 1 ? 'shareholder' : 'shareholders'} (may be partial)`,
  STATED_TOTAL: (total: string) => `Optional ASIC cross-check: ${total} issued shares`,
  STATED_COUNT: (count: number) => `Optional ASIC cross-check: ${count} shareholders listed`,
  IMPORTED_FIGURES: (total: string, count: number) =>
    `Company records: ${total} shares held by ${count} ${count === 1 ? 'member' : 'members'}`,
  DOWNLOAD_REGISTER: 'Download the register document',
  DOWNLOAD_ASIC: 'Download the ASIC extract',
  SOURCE_CONFIRMATION: 'These records mirror the company’s existing legal register.',
  UNKNOWN_ALLOTMENTS: 'Allotment particulars were not recorded in this earlier snapshot.',
  DECISION_RECEIPT_FAILED: 'The decision could not be confirmed. Refresh before retrying.',
  PREPARATION_RECEIPT_FAILED:
    'The prepared import could not be confirmed. Check the imports on Register before preparing again.',
  UPLOAD_RECEIPT_FAILED: 'The uploaded evidence could not be confirmed. Upload it again.',
  PREVIEW_FAILED: 'The decision could not be previewed. Refresh and try again.',
  DECIDE_FAILED: 'The decision was not recorded. Retry the same decision after refreshing.',
};
