import { useQuery } from '@tanstack/react-query';
import { getRegisterTransfers, readEveryPage, type OrderSubmissionOwner } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { READ_TIMING, registerKey } from '@hooks/useRegisterAccess';

export const transfersKey = (owner: OrderSubmissionOwner, token: string) => [...registerKey(owner), 'transfers', token];
export function useRegisterTransfers(owner: OrderSubmissionOwner, company: string, token: string, guard: () => void) {
  return useQuery({
    queryKey: transfersKey(owner, token),
    queryFn: async () => {
      const transfers = await readEveryPage(async (page) => {
        guard();
        const result = await getRegisterTransfers(apiClient, { token, page }, { ledovaSubmissionGuard: guard });
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
