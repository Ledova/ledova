import { useQuery } from '@tanstack/react-query';
import {
  appointmentForRegisterStep,
  canPersonallyAdministerCompany,
  getCompanies,
  getRegisterClasses,
  readEveryPage,
  useSubmissionOwner,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { READ_TIMING, useSignedInAppointments } from './useOwnAppointments';

export { READ_TIMING } from './useOwnAppointments';

export const REGISTER_QUERY_KEY = ['register'] as const;

export function registerKey(owner: OrderSubmissionOwner | null) {
  return [...REGISTER_QUERY_KEY, owner?.userUuid, owner?.ownerAccountUuid];
}

export function useRegisterEntryAccess(enabled = true) {
  const { owner, boundary } = useSubmissionOwner();
  return useQuery({
    queryKey: [...registerKey(owner), 'access'],
    enabled: !!owner && enabled,
    queryFn: async () => {
      if (!owner || boundary.get() !== owner) throw new Error('Your signed-in account changed.');
      const response = await getRegisterClasses(apiClient, { page: 1 });
      if (boundary.get() !== owner) throw new Error('Your signed-in account changed.');
      if (response.data.results.length > 0) return true;
      const companies = await readEveryPage((page) => {
        if (boundary.get() !== owner) throw new Error('Your signed-in account changed.');
        return getCompanies(apiClient, page, {
          ledovaSubmissionGuard: () => {
            if (boundary.get() !== owner) throw new Error('Your signed-in account changed.');
          },
        });
      });
      if (boundary.get() !== owner) throw new Error('Your signed-in account changed.');
      return companies.some(canPersonallyAdministerCompany);
    },
    ...READ_TIMING,
  });
}

export function useRegisterEntryState(enabled = true) {
  const access = useRegisterEntryAccess(enabled);
  const { owner } = useSubmissionOwner();
  const needsAppointments = enabled && access.isSuccess && !access.isFetching && !access.data;
  const appointments = useSignedInAppointments(needsAppointments);
  const canOpen =
    access.isSuccess &&
    !access.isFetching &&
    (access.data ||
      (appointments.isSuccess &&
        !!owner &&
        !appointments.isFetching &&
        appointments.data.some(
          (appointment) =>
            !appointment.revokedAt && appointmentForRegisterStep([appointment], appointment.company, 'prepare'),
        )));
  return {
    canOpen,
    isLoading:
      enabled &&
      (access.isPending ||
        access.isFetching ||
        (needsAppointments && (appointments.isPending || appointments.isFetching))),
    isError: access.isError || (needsAppointments && appointments.isError),
    refetch: () => Promise.all([access.refetch(), ...(needsAppointments ? [appointments.refetch()] : [])]),
  };
}
