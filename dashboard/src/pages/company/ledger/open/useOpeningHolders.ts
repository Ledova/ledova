import { useQuery } from '@tanstack/react-query';
import { failureStatus, type OrderSubmissionOwner, type OwnCompanyAppointment } from '@ledova/shared';
import { READ_TIMING } from '@hooks/useRegisterAccess';
import type { useOwnAppointments } from '@hooks/useOwnAppointments';
import { openingHoldersKey, readOpeningHolders } from '@pages/company/ledger/shared/useRegisterOpenings';

export function useOpeningHolders(
  owner: OrderSubmissionOwner,
  uuid: string,
  guard: () => void,
  appointment: OwnCompanyAppointment | undefined,
  appointments: ReturnType<typeof useOwnAppointments>,
) {
  const holders = useQuery({
    queryKey: openingHoldersKey(owner, uuid),
    enabled: !!appointment,
    queryFn: async () => {
      try {
        return await readOpeningHolders(uuid, guard);
      } catch (failure) {
        if (failureStatus(failure) === 404) void appointments.refetch();
        throw failure;
      }
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    ...READ_TIMING,
  });
  return holders;
}
