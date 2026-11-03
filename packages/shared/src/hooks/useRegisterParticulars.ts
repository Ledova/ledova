import { useQuery } from '@tanstack/react-query';
import { READ_TIMING } from '../constants/api';
import { getRegisterParticularsChanges } from '../services/register-particulars';
import { firstOfEach, readEveryPage } from '../utils/pagination';
import { useApiClient } from './useApiClient';
import { particularsKey } from './useParticularsEdit';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

export function useRegisterParticulars(
  owner: OrderSubmissionOwner,
  company: string,
  guard: () => void,
  enabled = true,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: particularsKey(owner, company),
    enabled,
    queryFn: async () => {
      const changes = await readEveryPage(async (page) => {
        guard();
        const result = await getRegisterParticularsChanges(
          apiClient,
          { company, page },
          { ...session?.requestConfig(), ledovaSubmissionGuard: guard },
        );
        guard();
        return result;
      });
      if (changes.some((change) => change.company !== company))
        throw new Error('The particulars changes did not identify this company.');
      return firstOfEach(changes, ({ uuid }) => uuid).sort(
        (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
      );
    },
    ...READ_TIMING,
  });
}
