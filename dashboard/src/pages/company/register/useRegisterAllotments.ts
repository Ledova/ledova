import { useQuery } from '@tanstack/react-query';
import { getRegisterAllotments, readEveryPage, type OrderSubmissionOwner } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { READ_TIMING, registerKey } from '@hooks/useRegisterAccess';
export const allotmentsKey = (owner: OrderSubmissionOwner, token: string) => [
  ...registerKey(owner),
  'allotments',
  token,
];

export function useRegisterAllotments(
  owner: OrderSubmissionOwner,
  company: string,
  token: string,
  guard: () => void,
  enabled = true,
) {
  return useQuery({
    queryKey: allotmentsKey(owner, token),
    enabled,
    queryFn: async () => {
      const rows = await readEveryPage(async (page) => {
        guard();
        const response = await getRegisterAllotments(
          apiClient,
          { company, token, page },
          { ledovaSubmissionGuard: guard },
        );
        guard();
        return response;
      });
      if (rows.some((row) => row.company !== company || row.token !== token))
        throw new Error('The allotments do not belong to this class .');
      return [...new Map(rows.map((row) => [row.uuid, row])).values()].sort(
        (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
      );
    },
    ...READ_TIMING,
  });
}
