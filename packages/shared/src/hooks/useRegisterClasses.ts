import { useQuery } from '@tanstack/react-query';
import { READ_TIMING } from '../constants/api';
import { getRegisterClasses } from '../services/company-tokens';
import { readEveryPage } from '../utils/pagination';
import { useApiClient } from './useApiClient';
import { registerClassesKey } from './useCompanyOwnership';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

export function useRegisterClasses(
  owner: OrderSubmissionOwner,
  guard: () => void,
  session?: OrderSubmissionSession,
  available = true,
) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: registerClassesKey(owner),
    enabled: available,
    queryFn: () =>
      readEveryPage(async (page) => {
        guard();
        const response = await getRegisterClasses(
          apiClient,
          { page },
          { ...session?.requestConfig(), ledovaSubmissionGuard: guard },
        );
        guard();
        return response;
      }),
    ...READ_TIMING,
  });
}
