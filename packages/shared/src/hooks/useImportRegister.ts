import { useQuery } from '@tanstack/react-query';
import { READ_TIMING } from '../constants/api';
import { ownershipSummary } from '../utils/register-ownership';
import { useApiClient } from './useApiClient';
import { registerKey } from './useCompanyOwnership';
import { readRegister } from './useRegisters';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

export function importRegisterKey(owner: OrderSubmissionOwner | null, uuid: string) {
  return [...registerKey(owner), 'holders', 'class', uuid];
}

export function useImportRegister(
  owner: OrderSubmissionOwner | null,
  uuid: string,
  readable: boolean,
  guard: () => void,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: importRegisterKey(owner, uuid),
    enabled: readable && !!owner,
    queryFn: async () => {
      const register = await readRegister(apiClient, uuid, guard, session);
      ownershipSummary([register]);
      return register;
    },
    ...READ_TIMING,
  });
}
