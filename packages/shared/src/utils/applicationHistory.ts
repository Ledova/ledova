import type { SubscriptionDetail } from '../types/domain/subscription';

export function applicationHistory(application: SubscriptionDetail): { label: string; at: string }[] {
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
  return events.filter((event): event is [string, string] => Boolean(event[1])).map(([label, at]) => ({ label, at }));
}
