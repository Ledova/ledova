import type { RegisterCorrectionAuthority, RegisterDecisionKind, RegisterWalletProof } from '../../types';

export const REGISTER_LINK_UNMET_COPY: Record<string, string> = {
  appointment_capability_required: 'Your appointment does not include this step.',
  link_decided: 'This wallet link has already been applied or rejected.',
  company_provided_evidence_required:
    'This wallet link was submitted for the retired staff review. It can only be rejected; prepare a new wallet ' +
    'link instead.',
  already_approved: 'This wallet link already has a current approval.',
  approval_required: 'Approve this wallet link before applying it.',
  approval_lapsed: "The approver's appointment has ended. Approve this wallet link again before applying it.",
  evidence_unavailable:
    'The retained copy of the authority document no longer matches its record. Prepare a new wallet link.',
  wallet_linked_elsewhere:
    'A mapped wallet address has since been linked to another member of the company. Reject this wallet link and ' +
    'prepare a new one for the wallets still waiting.',
  reason_required: 'Give a reason for the rejection.',
  reason_not_allowed: 'Approval and application take no reason.',
};

export const REGISTER_LINK_COPY = {
  TITLE: 'Wallet links',
  EMPTY: 'No wallet link has been prepared for this company.',
  PREPARE: 'Link waiting wallets',
  NOTHING_WAITING: 'No completed issue or transfer is waiting for a wallet to be linked.',
  PROVIDED_BY_COMPANY: 'Provided by the company',
  STAFF_VERIFIED: 'Verified by Ledova staff before wallet links were company-run',
  READ_ONLY_NOTE:
    'You can read these wallet links. Preparing, approving and applying a wallet link needs an appointment with ' +
    'administration or that step.',
  APPLY_NOTE:
    "Applying the wallet link records each wallet's member, creating any new member, and then records the completed " +
    'issues and transfers that can now be recorded, each dated the day it is recorded. Nothing changes on chain.',
  STAGES: {
    submitted: 'Prepared',
    approved: 'Approved',
    applied: 'Applied',
    rejected: 'Rejected',
  } as Record<string, string>,
  DECISIONS: { approve: 'Approve', apply: 'Apply', reject: 'Reject' } as Record<RegisterDecisionKind, string>,
  CONFIRMATIONS: {
    approve: 'Approve this wallet link exactly as prepared.',
    apply: 'Apply this wallet link now, linking each wallet to its member. This cannot be undone.',
    reject: 'Reject this wallet link with the reason given.',
  } as Record<RegisterDecisionKind, string>,
  REJECTION_REASON: 'Reason for rejection',
  WALLETS: 'Wallets',
  MEMBER: 'Member',
  NEW_MEMBER: 'New member',
  UNNAMED_MEMBER: 'Unnamed member',
  NOT_ON_REGISTER: 'A member not on the current register',
  HOLDING: (shares: string, shareClass: string) => `${shares} ${shareClass} ${shares === '1' ? 'share' : 'shares'}`,
  MAPPING_NOTE:
    'Choose the member who owns each wallet: an existing member, or a new member that applying the link creates. ' +
    'Choose the same member for wallets that belong to one person.',
  CHOICES_RESET: 'The waiting wallets changed, so some member choices were reset. Check each wallet before preparing.',
  WAITING: (count: number) =>
    `${count} completed ${count === 1 ? 'issue or transfer waits' : 'issues or transfers wait'} for this wallet to ` +
    'be linked',
  WALLET_PROOF: {
    proven: 'The holder proved control of this wallet on Ledova',
    not_proven: 'The holder has not proved control of this wallet on Ledova',
  } as Record<RegisterWalletProof, string>,
  HOLDER: 'Holder on Ledova',
  STATUS_NOTE:
    'The proof and holder are shown for information only: a wallet link needs neither, and the company chooses ' +
    'each member itself.',
  NO_STATUS: "This wallet is not on the company's whitelist, so no proof or holder is shown for it.",
  AUTHORITY_DOCUMENT: 'Authority document',
  AUTHORITY_DOCUMENT_NOTE:
    'The director resolution or court order that authorises this wallet link, provided by the company. PDF or ' +
    'image, max 10 MB. Ledova does not verify it.',
  AUTHORITY: 'Authority',
  AUTHORITIES: {
    director_resolution: 'Director resolution',
    court_order: 'Court order',
  } as Record<RegisterCorrectionAuthority, string>,
  APPROVING_DIRECTOR: 'Approving director',
  AUTHORITY_REFERENCE: 'Authority reference',
  REASON: 'Reason',
  SUBMIT: 'Prepare wallet link',
  DOWNLOAD: 'Download the authority document',
  MAPPING_UNREADABLE: 'The wallet link mapping could not be read.',
  UPLOAD_RECEIPT_FAILED: 'The uploaded authority document could not be confirmed. Upload it again.',
  PREPARATION_RECEIPT_FAILED:
    'The prepared wallet link could not be confirmed. Check the wallet links on Register before preparing again.',
  DECISION_RECEIPT_FAILED: 'The decision could not be confirmed. Refresh before retrying.',
  PREVIEW_FAILED: 'The decision could not be previewed. Refresh and try again.',
  DECIDE_FAILED: 'The decision was not recorded. Retry the same decision after refreshing.',
};
