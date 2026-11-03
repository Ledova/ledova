import { useQuery } from '@tanstack/react-query';
import { READ_TIMING } from '../constants/api';
import { getOwnCompanyAppointments } from '../services/company-authority';
import { readEveryPage } from '../utils/pagination';
import { useApiClient } from './useApiClient';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

export const OWN_APPOINTMENTS_QUERY_KEY = ['company-appointments'] as const;

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
    session?: OrderSubmissionSession;
  } = {},
) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: policy.queryKey ?? ownAppointmentsKey(owner),
    queryFn: () =>
      readEveryPage(async (page) => {
        guard();
        const result = await getOwnCompanyAppointments(apiClient, page, {
          ...policy.session?.requestConfig(),
          ledovaSubmissionGuard: guard,
        });
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
