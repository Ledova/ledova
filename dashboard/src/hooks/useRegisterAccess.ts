import type { OrderSubmissionOwner } from '@ledova/shared';

export { READ_TIMING } from './useOwnAppointments';

export const REGISTER_QUERY_KEY = ['register'] as const;

export function registerKey(owner: OrderSubmissionOwner | null) {
  return [...REGISTER_QUERY_KEY, owner?.userUuid, owner?.ownerAccountUuid];
}
