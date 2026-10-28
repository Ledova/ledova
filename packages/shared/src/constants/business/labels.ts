import type {
  CompanyEligibilityRequest,
  CompanyWalletInstruction,
  MemberCertificateRequest,
  MemberInvitation,
  MemberParticularsRequest,
  OrderActionChange,
  OwnCompanyAppointment,
  SwapSettlementApprovalOutcome,
  TransferOrder,
} from '../../types';
import type { SubscriptionStatus } from './subscriptions';

export const ELIGIBILITY_OUTCOME_LABELS: Record<CompanyEligibilityRequest['outcome'], string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  refused: 'Refused',
  withdrawn: 'Withdrawn',
  revoked: 'Revoked',
  expired: 'Expired',
};

export const MEMBER_INVITATION_STATUS_LABELS: Record<MemberInvitation['status'], string> = {
  pending: 'Pending',
  expired: 'Expired',
  unavailable: 'No longer available',
  accepted: 'Accepted',
  revoked: 'Revoked',
};

export const MEMBER_PARTICULARS_STATUS_LABELS: Record<MemberParticularsRequest['status'], string> = {
  submitted: 'Submitted',
  prepared: 'Prepared by the company',
  approved: 'Approved',
  applied: 'Applied',
  rejected: 'Rejected',
};

export const MEMBER_CERTIFICATE_STATUS_LABELS: Record<MemberCertificateRequest['status'], string> = {
  requested: 'Requested',
  withdrawn: 'Withdrawn',
  fulfilled: 'Fulfilled',
};

export const APPOINTMENT_STATUS_LABELS: Record<OwnCompanyAppointment['status'], string> = {
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
};

export const COMPANY_WALLET_ACTION_LABELS: Record<CompanyWalletInstruction['action'], string> = {
  add: 'Approve nominated wallet',
  remove: 'Remove retained approval',
};

export const CHAIN_FAILURE_LABELS: Record<string, string> = {
  failed: 'Failed before signing',
  reverted: 'Reverted',
};

export const DEPLOYMENT_SWAP_APPROVAL_LABELS: Record<string, string> = {
  pending: 'Pending approval',
  executing: 'Approval in progress',
  confirmed: 'Approval confirmed',
  observed_approved: 'Existing approval observed',
  not_configured: 'Swap unavailable at deployment',
  failed: 'Approval failed',
};

export const COMPANY_SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  accepted: 'Accepted',
  awaiting_payment: 'Awaiting payment',
  paid: 'Paid',
  allotted: 'Allotted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  refunded: 'Refunded',
};

export const ORDER_STATUS_LABELS: Record<TransferOrder['status'], string> = {
  open: 'Open',
  partially_filled: 'Partially Filled',
  held: 'Held Back',
  matched: 'Matched',
  pending_signature: 'Pending Signature',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const ORDER_CHANGE_FIELD_LABELS: Record<OrderActionChange['field'], string> = {
  quantity: 'Quantity',
  min_quantity: 'Minimum fill',
  price_per_share: 'Price per share',
};

export const SWAP_APPROVAL_OUTCOME_LABELS: Record<SwapSettlementApprovalOutcome['outcome'], string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  reverted: 'Reverted',
  superseded: 'Superseded',
};

export const IDENTITY_SOURCE_LABELS: Record<string, string> = {
  profile: 'Current profile',
  stamped: 'Stamped at the time',
  recorded: 'Name recorded at allotment, identity never resolved',
  particulars: 'Recorded register particulars',
  treasury_label: 'Whitelist entry label, no profile exists',
  unresolvable: 'Not resolvable, two wallets share this address',
  none: 'Not identified',
  unknown: 'Never identified while it held shares',
  company_recorded: 'Recorded by the company',
};
