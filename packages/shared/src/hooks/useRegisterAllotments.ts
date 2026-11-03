import { useQuery } from '@tanstack/react-query';
import { READ_TIMING } from '../constants/api';
import { getRegisterAllotments } from '../services/register-allotments';
import { readEveryPage } from '../utils/pagination';
import { useApiClient } from './useApiClient';
import { registerKey } from './useCompanyOwnership';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

export function allotmentsKey(owner: OrderSubmissionOwner, token: string) {
  return [...registerKey(owner), 'allotments', token];
}

export function useRegisterAllotments(
  owner: OrderSubmissionOwner,
  company: string,
  token: string,
  guard: () => void,
  enabled = true,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: allotmentsKey(owner, token),
    enabled,
    queryFn: async () => {
      const rows = await readEveryPage(async (page) => {
        guard();
        const response = await getRegisterAllotments(
          apiClient,
          { company, token, page },
          { ...session?.requestConfig(), ledovaSubmissionGuard: guard },
        );
        guard();
        return response;
      });
      if (rows.some((row) => row.company !== company || row.token !== token))
        throw new Error('The allotments do not belong to this class.');
      return [...new Map(rows.map((row) => [row.uuid, row])).values()].sort(
        (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
      );
    },
    ...READ_TIMING,
  });
}
