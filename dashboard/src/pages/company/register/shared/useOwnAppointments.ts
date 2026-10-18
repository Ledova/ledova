import { useQuery } from '@tanstack/react-query';
import { getOwnCompanyAppointments, readEveryPage, type OrderSubmissionOwner } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { ownAppointmentsKey } from '@pages/company/shared/appointments';
import { READ_TIMING } from '@hooks/useRegisterAccess';

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
