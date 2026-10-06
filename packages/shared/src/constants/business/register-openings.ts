import type { RegisterCorrectionAuthority, RegisterDecisionKind } from '../../types';

export const REGISTER_OPENING_UNMET_COPY: Record<string, string> = {
  appointment_capability_required: 'Your appointment does not include this step.',
  opening_decided: 'This opening has already been applied or rejected.',
  company_provided_evidence_required:
    'This opening was submitted for the retired staff review. It can only be rejected; prepare a new opening ' +
    'instead.',
  already_approved: 'This opening already has a current approval.',
  approval_required: 'Approve this opening before applying it.',
  approval_lapsed: "The approver's appointment has ended. Approve this opening again before applying it.",
  evidence_unavailable:
    'The retained copy of the authority document no longer matches its record. Prepare a new opening.',
  boundary_changed:
    'The chain no longer confirms the boundary block this opening was prepared at, or its finality policy changed. ' +
    'Reject it and prepare a new opening from the current holdings.',
  register_initialized:
    "This share class's register already has an entry, so it cannot be opened again. Reject this opening.",
  completions_not_represented:
    'A completed issue or transfer is not represented at the boundary block. Reject this opening and prepare a new ' +
    'one.',
  wallet_linked_elsewhere:
    'A mapped wallet address has since been linked to another member of the company. Reject this opening and ' +
    'prepare a new one.',
  reason_required: 'Give a reason for the rejection.',
  reason_not_allowed: 'Approval and application take no reason.',
};

export const REGISTER_OPENING_COPY = {
  TITLE: 'Openings',
  EMPTY: 'No opening has been prepared for this share class.',
  PREPARE: 'Open this register',
  PROVIDED_BY_COMPANY: 'Provided by the company',
  STAFF_VERIFIED: 'Verified by Ledova staff before openings were company-run',
  READ_ONLY_NOTE:
    'You can read these openings. Preparing, approving and applying an opening needs an appointment with ' +
    'administration or that step.',
  BOUNDARY_NOTE:
    'The boundary is the chain block captured when the opening is prepared. The chain is checked again before ' +
    'the opening is approved and before it is applied.',
  HOLDINGS_NOTE:
    "The opening records the holdings at that block as the register's first entry, dated on the block's date. " +
    'Nothing changes on chain.',
  STAGES: {
    submitted: 'Prepared',
    approved: 'Approved',
    applied: 'Applied',
    rejected: 'Rejected',
  } as Record<string, string>,
  DECISIONS: { approve: 'Approve', apply: 'Apply', reject: 'Reject' } as Record<RegisterDecisionKind, string>,
  CONFIRMATIONS: {
    approve: 'Approve this opening exactly as prepared.',
    apply: 'Apply this opening now, opening the register from its boundary. This cannot be undone.',
    reject: 'Reject this opening with the reason given.',
  } as Record<RegisterDecisionKind, string>,
  REJECTION_REASON: 'Reason for rejection',
  BOUNDARY: 'Boundary',
  BOUNDARY_BLOCK: (block: number, date: string) => `Block ${block}, dated ${date}`,
  HOLDINGS: 'Holdings at the boundary',
  NO_HOLDINGS:
    'No address held shares of this class at the boundary, so applying this opening records an empty register.',
  MEMBER: 'Member',
  NEW_MEMBER: 'New member',
  NEW_MEMBER_NUMBERED: (number: number) => `New member ${number}`,
  LINKED_NOTE: 'This address is already linked to this member, so the opening keeps that link.',
  HOLDERS_UNAVAILABLE: "The chain can't be read now, so the holdings at the boundary can't be shown. Try again later.",
  HOLDINGS_MOVED:
    'The holdings on chain changed after they were read, so the addresses no longer match. Reload the holdings and ' +
    'map them again.',
  RELOAD_HOLDINGS: 'Reload the holdings',
  AUTHORITY_DOCUMENT: 'Authority document',
  AUTHORITY_DOCUMENT_NOTE:
    'The director resolution or court order that authorises this opening, provided by the company. PDF or image, ' +
    'max 10 MB. Ledova does not verify it.',
  AUTHORITY: 'Authority',
  AUTHORITIES: {
    director_resolution: 'Director resolution',
    court_order: 'Court order',
  } as Record<RegisterCorrectionAuthority, string>,
  APPROVING_DIRECTOR: 'Approving director',
  AUTHORITY_REFERENCE: 'Authority reference',
  REASON: 'Reason',
  SUBMIT: 'Prepare opening',
  DOWNLOAD: 'Download the authority document',
  MAPPING_UNREADABLE: 'The register opening mapping could not be read.',
  UPLOAD_RECEIPT_FAILED: 'The uploaded authority document could not be confirmed. Upload it again.',
  PREPARATION_RECEIPT_FAILED:
    'The prepared opening could not be confirmed. Check the openings on Register before preparing again.',
  DECISION_RECEIPT_FAILED: 'The decision could not be confirmed. Refresh before retrying.',
  PREVIEW_FAILED: 'The decision could not be previewed. Refresh and try again.',
  DECIDE_FAILED: 'The decision was not recorded. Retry the same decision after refreshing.',
};
