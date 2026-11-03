import { useQuery } from '@tanstack/react-query';
import {
  getRegisterClasses,
  readEveryPage,
  READ_TIMING,
  registerClassesKey,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import apiClient from '@services/apiClient';

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
