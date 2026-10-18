import { useQuery } from '@tanstack/react-query';
import type { OrderSubmissionOwner } from '@ledova/shared';
import { READ_TIMING, registerKey } from '@hooks/useRegisterAccess';
import { readRegister } from '@pages/company/shared/useCompanyRegister';

export function importRegisterKey(owner: OrderSubmissionOwner, uuid: string) {
  return [...registerKey(owner), 'holders', 'class', uuid];
}

export function useImportRegister(owner: OrderSubmissionOwner, uuid: string, readable: boolean) {
  const register = useQuery({
    queryKey: importRegisterKey(owner, uuid),
    enabled: readable,
    queryFn: () => readRegister(uuid),
    ...READ_TIMING,
  });
  return register;
}
