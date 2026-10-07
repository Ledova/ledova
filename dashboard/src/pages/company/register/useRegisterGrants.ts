import { useQuery } from '@tanstack/react-query';
import { getRegisterGrants, readEveryPage, type OrderSubmissionOwner } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { READ_TIMING, registerKey } from './useCompanyRegister';

export const grantsKey = (owner: OrderSubmissionOwner, token: string) => [...registerKey(owner), 'grants', token];

export function useRegisterGrants(owner: OrderSubmissionOwner, company: string, token: string, guard: () => void) {
  return useQuery({
    queryKey: grantsKey(owner, token),
    queryFn: async () => {
      const grants = await readEveryPage(async (page) => {
        guard();
        const result = await getRegisterGrants(apiClient, { token, page }, { ledovaSubmissionGuard: guard });
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
