import { useQuery } from '@tanstack/react-query';
import {
  getOwnCompanyAppointments,
  readEveryPage,
  type OrderSubmissionOwner,
  OWN_APPOINTMENTS_QUERY_KEY,
  CACHE_TIMING,
} from '@ledova/shared';
import apiClient from '@services/apiClient';

export const READ_TIMING = {
  staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  gcTime: CACHE_TIMING.MEDIUM_GC_TIME,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
};

export function ownAppointmentsKey(owner: OrderSubmissionOwner) {
  return [...OWN_APPOINTMENTS_QUERY_KEY, owner.userUuid, owner.ownerAccountUuid];
}

export function useOwnAppointments(
  owner: OrderSubmissionOwner,
  guard: () => void,
  policy: {
    queryKey?: readonly unknown[];
    enabled?: boolean;
    timing?: Partial<Pick<typeof READ_TIMING, 'staleTime' | 'gcTime'>>;
    passive?: boolean;
  } = {},
) {
  return useQuery({
    queryKey: policy.queryKey ?? ownAppointmentsKey(owner),
    queryFn: () =>
      readEveryPage(async (page) => {
        guard();
        const result = await getOwnCompanyAppointments(apiClient, page, { ledovaSubmissionGuard: guard });
        guard();
        return result;
      }),
    ...(policy.timing ?? READ_TIMING),
    refetchOnWindowFocus: READ_TIMING.refetchOnWindowFocus,
    refetchOnReconnect: READ_TIMING.refetchOnReconnect,
    ...(policy.passive ? { refetchOnMount: false, retryOnMount: false, retry: false } : {}),
    ...(policy.enabled === undefined ? {} : { enabled: policy.enabled }),
  });
}
