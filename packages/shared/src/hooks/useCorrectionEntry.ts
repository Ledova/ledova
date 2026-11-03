import { useQuery } from '@tanstack/react-query';
import { READ_TIMING } from '../constants/api';
import type { OwnCompanyAppointment } from '../types';
import { useApiClient } from './useApiClient';
import { readClassEntry } from './useRegisterEntries';
import { entriesKey } from './useShareholder';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

export function useCorrectionEntry(
  owner: OrderSubmissionOwner,
  uuid: string,
  entry: string,
  guard: () => void,
  appointment: OwnCompanyAppointment | undefined,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  const corrected = useQuery({
    queryKey: [...entriesKey(owner, uuid), entry],
    enabled: !!appointment,
    queryFn: () => readClassEntry(apiClient, uuid, entry, guard, session),
    ...READ_TIMING,
  });
  return corrected;
}
