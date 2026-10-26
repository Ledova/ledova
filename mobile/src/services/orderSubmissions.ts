import type { OrderSubmissionSession } from '@ledova/shared';
import { getSessionEpoch, subscribeSession } from './sessionScope';

export const orderSubmissionSession: OrderSubmissionSession = {
  getEpoch: getSessionEpoch,
  subscribe: subscribeSession,
  requestConfig: () => ({ ledovaSessionEpoch: getSessionEpoch() }),
};
