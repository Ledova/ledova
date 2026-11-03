import { useQuery } from '@tanstack/react-query';
import { READ_TIMING } from '../constants/api';
import { getRegisterGrants } from '../services/register-grants';
import { readEveryPage } from '../utils/pagination';
import { useApiClient } from './useApiClient';
import { registerKey } from './useCompanyOwnership';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

export function grantsKey(owner: OrderSubmissionOwner, token: string) {
  return [...registerKey(owner), 'grants', token];
}

export function useRegisterGrants(
  owner: OrderSubmissionOwner,
  company: string,
  token: string,
  guard: () => void,
  enabled = true,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: grantsKey(owner, token),
    enabled,
    queryFn: async () => {
      const grants = await readEveryPage(async (page) => {
        guard();
        const result = await getRegisterGrants(
          apiClient,
          { token, page },
          { ...session?.requestConfig(), ledovaSubmissionGuard: guard },
        );
        guard();
        return result;
      });
      if (grants.some((grant) => grant.token !== token || grant.company !== company))
        throw new Error('The grants do not belong to this share class.');
      return grants.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    },
    ...READ_TIMING,
  });
}
