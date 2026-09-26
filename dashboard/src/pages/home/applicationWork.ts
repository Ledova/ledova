import type { Subscription, SubscriptionStatus } from '@ledova/shared';

export interface ApplicationWork {
  application: Subscription;
  description: string;
}

const NEEDS_YOU: Partial<Record<SubscriptionStatus, string>> = {
  draft: 'Review and submit your draft',
  awaiting_payment: 'View your payment instruction',
};

const IN_PROGRESS: Partial<Record<SubscriptionStatus, string>> = {
  submitted: 'Under review by the operator',
  accepted: 'Accepted, payment instruction next',
  paid: 'Payment received',
};

export function applicationWork(applications: Subscription[]) {
  const needsYou: ApplicationWork[] = [];
  const inProgress: ApplicationWork[] = [];

  for (const application of applications) {
    const action = NEEDS_YOU[application.status];
    const progress = IN_PROGRESS[application.status];
    if (action) needsYou.push({ application, description: action });
    if (progress) inProgress.push({ application, description: progress });
  }

  return { needsYou, inProgress };
}
