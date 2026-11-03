import { useQuery } from '@tanstack/react-query';
import { READ_TIMING, entriesKey, type OrderSubmissionOwner, type OwnCompanyAppointment } from '@ledova/shared';
import { readClassEntry } from '@pages/company/ledger/shared/useRegisterEntries';

export function useCorrectionEntry(
  owner: OrderSubmissionOwner,
  uuid: string,
  entry: string,
  guard: () => void,
  appointment: OwnCompanyAppointment | undefined,
) {
  const corrected = useQuery({
    queryKey: [...entriesKey(owner, uuid), entry],
    enabled: !!appointment,
    queryFn: () => readClassEntry(uuid, entry, guard),
    ...READ_TIMING,
  });
  return corrected;
}
