import type { RegisterDecisionKind } from '../../types';

export const REGISTER_PARTICULARS_COPY = {
  TITLE: 'Particulars changes',
  PREPARE: 'Change particulars',
  PROVIDED_BY_COMPANY: 'Provided by the company',
  AUTHORITY_NOTE:
    "Changing a member's particulars needs an appointment with administration, or with preparation, approval and " +
    'application.',
  PRECEDENCE_NOTE:
    "The latest as-at date wins between imported particulars and changes, and a member's live verified identity " +
    'still wins over both.',
  STAGES: {
    submitted: 'Prepared, not applied',
    approved: 'Approved, not applied',
    applied: 'Applied',
    rejected: 'Rejected',
  } as Record<string, string>,
  DECISIONS: { approve: 'Approve', apply: 'Apply', reject: 'Reject' } as Record<RegisterDecisionKind, string>,
  UNNAMED_MEMBER: 'A member not named on the current register',
  BEFORE: 'Before',
  AFTER: 'After',
  NOT_RECORDED_BEFORE: 'No particulars were recorded before this change.',
  PROPOSED_PARTICULARS: 'Proposed particulars',
  NAME: 'Name',
  RESIDENTIAL_ADDRESS: 'Residential address',
  AS_AT: 'As at',
  REASON: 'Reason',
  REASON_NOTE: 'Kept with the change in the register history.',
  SUBMIT: 'Save change',
  RELOAD: 'Load current particulars',
  DOWNLOAD: 'Download the supporting document',
  RECEIPT_FAILED:
    'The change could not be confirmed. Check the particulars changes under Corrections before changing them again.',
};
