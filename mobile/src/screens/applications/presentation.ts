import { SUBSCRIPTION_STATUS_LABELS, type Subscription, type SubscriptionDetail } from '@ledova/shared';

export function applicationState(application: Pick<Subscription, 'status' | 'statusDisplay'>) {
  return SUBSCRIPTION_STATUS_LABELS[application.status] ?? application.statusDisplay;
}

export function applicationHistory(application: SubscriptionDetail) {
  const events: [string, string | null | undefined][] = [
    ['Drafted', application.createdAt],
    ['Submitted for review', application.submittedAt],
    ['Accepted by the operator', application.acceptedAt],
    ['Payment instruction issued', application.paymentInstructionIssuedAt],
    ['Payment received', application.paymentReceivedOn],
    ['Shares allotted', application.allottedAt],
    ['Refunded', application.refundedAt],
    [application.status === 'withdrawn' ? 'Withdrawn' : 'Rejected', application.closedAt],
  ];
  return events.filter((event): event is [string, string] => Boolean(event[1]));
}
