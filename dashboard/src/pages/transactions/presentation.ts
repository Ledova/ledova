import { getTransactionStatus } from '@ledova/shared';
import type { Transaction } from '@ledova/shared';
import type { Tone } from '@components/Ledger';

export function activityState(transaction: Transaction) {
  const state = getTransactionStatus(transaction.status);
  const tones: Record<typeof state.tone, Tone> = {
    success: 'done',
    error: 'closed',
    warning: 'moving',
    info: 'waiting',
  };
  return { label: state.label, mark: state.mark, tone: tones[state.tone] };
}
