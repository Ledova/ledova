import { useQuery } from '@tanstack/react-query';
import { READ_TIMING } from '../constants/api';
import { useApiClient } from './useApiClient';
import { registerKey } from './useCompanyOwnership';
import { readRegister } from './useRegisters';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

export function importRegisterKey(owner: OrderSubmissionOwner, uuid: string) {
  return [...registerKey(owner), 'holders', 'class', uuid];
}

export function useImportRegister(
  owner: OrderSubmissionOwner,
  uuid: string,
  readable: boolean,
  guard: () => void,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: importRegisterKey(owner, uuid),
    enabled: readable,
    queryFn: () => readRegister(apiClient, uuid, guard, session),
    ...READ_TIMING,
  });
}
