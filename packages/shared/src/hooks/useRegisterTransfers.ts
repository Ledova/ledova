import { useQuery } from '@tanstack/react-query';
import { READ_TIMING } from '../constants/api';
import { getRegisterTransfers } from '../services/register-transfers';
import { readEveryPage } from '../utils/pagination';
import { useApiClient } from './useApiClient';
import { registerKey } from './useCompanyOwnership';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

export function transfersKey(owner: OrderSubmissionOwner, token: string) {
  return [...registerKey(owner), 'transfers', token];
}

export function useRegisterTransfers(
  owner: OrderSubmissionOwner,
  company: string,
  token: string,
  guard: () => void,
  enabled = true,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: transfersKey(owner, token),
    enabled,
    queryFn: async () => {
      const transfers = await readEveryPage(async (page) => {
        guard();
        const result = await getRegisterTransfers(
          apiClient,
          { token, page },
          { ...session?.requestConfig(), ledovaSubmissionGuard: guard },
        );
        guard();
        return result;
      });
      if (transfers.some((transfer) => transfer.token !== token || transfer.company !== company))
        throw new Error('The transfers do not belong to this share class.');
      return transfers.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    },
    ...READ_TIMING,
  });
}
