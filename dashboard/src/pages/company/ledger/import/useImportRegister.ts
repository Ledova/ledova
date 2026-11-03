import { useQuery } from '@tanstack/react-query';
import { READ_TIMING, readRegister, registerKey, type OrderSubmissionOwner } from '@ledova/shared';
import apiClient from '@services/apiClient';

export function importRegisterKey(owner: OrderSubmissionOwner, uuid: string) {
  return [...registerKey(owner), 'holders', 'class', uuid];
}

export function useImportRegister(owner: OrderSubmissionOwner, uuid: string, readable: boolean, guard: () => void) {
  const register = useQuery({
    queryKey: importRegisterKey(owner, uuid),
    enabled: readable,
    queryFn: () => readRegister(apiClient, uuid, guard),
    ...READ_TIMING,
  });
  return register;
}
