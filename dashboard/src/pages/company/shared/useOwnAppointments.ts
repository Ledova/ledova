import { useQuery } from '@tanstack/react-query';
import {
  getOwnCompanyAppointments,
  readEveryPage,
  type OrderSubmissionOwner,
  OWN_APPOINTMENTS_QUERY_KEY,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { READ_TIMING } from '@hooks/useRegisterAccess';

export function ownAppointmentsKey(owner: OrderSubmissionOwner) {
  return [...OWN_APPOINTMENTS_QUERY_KEY, owner.userUuid, owner.ownerAccountUuid];
}

export function useOwnAppointments(owner: OrderSubmissionOwner, guard: () => void) {
  return useQuery({
    queryKey: ownAppointmentsKey(owner),
    queryFn: () =>
      readEveryPage(async (page) => {
        guard();
        const result = await getOwnCompanyAppointments(apiClient, page, { ledovaSubmissionGuard: guard });
        guard();
        return result;
      }),
    ...READ_TIMING,
  });
}
