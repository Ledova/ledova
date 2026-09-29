import type { ApiComponents } from '../../generated/api';

export type SubscriptionStatus = ApiComponents['schemas']['SubscriptionStatusEnum'];

export const SUBSCRIPTION_ENDPOINTS = {
  BASE: '/api/v1/subscriptions/',
  DETAIL: (uuid: string) => `/api/v1/subscriptions/${uuid}/` as const,
  SUBMIT: (uuid: string) => `/api/v1/subscriptions/${uuid}/submit/` as const,
  WITHDRAW: (uuid: string) => `/api/v1/subscriptions/${uuid}/withdraw/` as const,
} as const;

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  draft: 'Draft',
  submitted: 'Under review by the operator',
  accepted: 'Accepted, payment instruction next',
  awaiting_payment: 'Awaiting your payment',
  paid: 'Payment received, allotment next',
  allotted: 'Shares allotted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  refunded: 'Refunded',
};

export const SUBSCRIPTION_IN_PROGRESS_STATUSES: SubscriptionStatus[] = ['submitted', 'accepted', 'paid'];

export const SUBSCRIPTION_WITHDRAWABLE_STATUSES: SubscriptionStatus[] = [
  'draft',
  'submitted',
  'accepted',
  'awaiting_payment',
];

export const SUBSCRIPTION_SUBMITTABLE_STATUSES: SubscriptionStatus[] = ['draft'];

export const SUBSCRIPTION_COPY = {
  DRAFT_HELP:
    'A draft is not sent to anyone. Submitting it re-checks your investor classification and sends it to the ' +
    'operator, who accepts it and issues the exact amount and reference to pay.',
  AWAITING_PAYMENT_HELP:
    'Pay the exact amount and quote the reference exactly. The operator matches the payment by that reference, ' +
    'and shares are allotted only once the money has arrived.',
  PAID_HELP:
    'The operator has confirmed your payment. Your shares are allotted on chain shortly afterwards and then ' +
    'appear in your portfolio.',
  MONEY_IN_HELP: 'An application with money recorded against it cannot be withdrawn. Ask the operator for a refund.',
} as const;
