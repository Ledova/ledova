import { SUBSCRIPTION_IN_PROGRESS_STATUSES, SUBSCRIPTION_STATUS_LABELS } from '@ledova/shared';
import type { Subscription, SubscriptionStatus } from '@ledova/shared';

export interface ApplicationWork {
  application: Subscription;
  description: string;
}

const NEEDS_YOU: Partial<Record<SubscriptionStatus, string>> = {
  draft: 'Review and submit your draft',
  awaiting_payment: 'View your payment instruction',
};

export function applicationWork(applications: Subscription[]) {
  const needsYou: ApplicationWork[] = [];
  const inProgress: ApplicationWork[] = [];

  for (const application of applications) {
    const action = NEEDS_YOU[application.status];
    if (action) needsYou.push({ application, description: action });
    if (SUBSCRIPTION_IN_PROGRESS_STATUSES.includes(application.status)) {
      inProgress.push({ application, description: SUBSCRIPTION_STATUS_LABELS[application.status] });
    }
  }

  return { needsYou, inProgress };
}
