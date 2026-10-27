import { useQuery } from '@tanstack/react-query';
import { getRegisterClasses, readEveryPage, type OrderSubmissionOwner } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { READ_TIMING, registerKey } from './useRegisterAccess';

export function registerClassesKey(owner: OrderSubmissionOwner) {
  return [...registerKey(owner), 'classes'];
}

export function registerHoldersKey(owner: OrderSubmissionOwner) {
  return [...registerKey(owner), 'holders'];
}

export function useRegisterClasses(owner: OrderSubmissionOwner, guard: () => void) {
  return useQuery({
    queryKey: registerClassesKey(owner),
    queryFn: () =>
      readEveryPage(async (page) => {
        guard();
        const response = await getRegisterClasses(apiClient, { page }, { ledovaSubmissionGuard: guard });
        guard();
        return response;
      }),
    ...READ_TIMING,
  });
}
