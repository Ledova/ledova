import { SUBSCRIPTION_TONES } from '@components/statusTones';
import { SUBSCRIPTION_STATUS_LABELS } from '@ledova/shared';
import type { Subscription } from '@ledova/shared';
import type { Tone } from '@components/Ledger';

export function applicationState(application: Pick<Subscription, 'status' | 'statusDisplay'>) {
  return {
    words: SUBSCRIPTION_STATUS_LABELS[application.status] ?? application.statusDisplay,
    tone: SUBSCRIPTION_TONES[application.status] ?? ('moving' as Tone),
  };
}
