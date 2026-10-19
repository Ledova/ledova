import { useQuery } from '@tanstack/react-query';
import {
  getOwnCompanyAppointments,
  readEveryPage,
  useSubmissionOwner,
  type OrderSubmissionOwner,
  OWN_APPOINTMENTS_QUERY_KEY,
  CACHE_TIMING,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
export const READ_TIMING = { staleTime: CACHE_TIMING.SHORT_STALE_TIME, gcTime: CACHE_TIMING.MEDIUM_GC_TIME };

export function ownAppointmentsKey(owner: OrderSubmissionOwner) {
  return [...OWN_APPOINTMENTS_QUERY_KEY, owner.userUuid, owner.ownerAccountUuid];
}

export function useOwnAppointments(
  owner: OrderSubmissionOwner,
  guard: () => void,
  policy: { queryKey?: readonly unknown[]; enabled?: boolean; timing?: Partial<typeof READ_TIMING> } = {},
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
    ...(policy.enabled === undefined ? {} : { enabled: policy.enabled }),
  });
}

export function useSignedInAppointments(enabled = true) {
  const { owner, boundary } = useSubmissionOwner();
  const guard = () => {
    if (!owner || boundary.get() !== owner) throw new Error('Your signed-in account changed.');
  };
  return useOwnAppointments(owner!, guard, {
    queryKey: owner ? ownAppointmentsKey(owner) : [...OWN_APPOINTMENTS_QUERY_KEY, null],
    enabled: !!owner && enabled,
  });
}
