import { useQuery } from '@tanstack/react-query';
import { getRegisterAllotments, readEveryPage } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { registerKey } from './useCompanyRegister';
export const allotmentsKey = (epoch: number, token: string) => [...registerKey(epoch), 'allotments', token];

export function useRegisterAllotments(
  epoch: number,
  company: string,
  token: string,
  guard: () => void,
  enabled: boolean,
) {
  return useQuery({
    queryKey: allotmentsKey(epoch, token),
    enabled,
    queryFn: async ({ signal }) => {
      const rows = await readEveryPage(async (page) => {
        guard();
        const response = await getRegisterAllotments(
          apiClient,
          { company, token, page },
          { ledovaSessionEpoch: epoch, ledovaSubmissionGuard: guard, signal },
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
  });
}
