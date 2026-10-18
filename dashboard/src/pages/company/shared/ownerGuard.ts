import { createUserFriendlyError, type OrderSubmissionOwner } from '@ledova/shared';

const ACCOUNT_CHANGED = 'Your signed-in account changed. Reopen the register.';

export function ownerGuard(owner: OrderSubmissionOwner, currentOwner: () => OrderSubmissionOwner | null) {
  return () => {
    if (currentOwner() !== owner) throw createUserFriendlyError(ACCOUNT_CHANGED);
  };
}
