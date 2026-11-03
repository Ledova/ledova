import { useQuery } from '@tanstack/react-query';
import {
  firstOfEach,
  getRegisterParticularsChanges,
  particularsKey,
  readEveryPage,
  type OrderSubmissionOwner,
  READ_TIMING,
} from '@ledova/shared';
import apiClient from '@services/apiClient';

export function useRegisterParticulars(owner: OrderSubmissionOwner, company: string, guard: () => void) {
  return useQuery({
    queryKey: particularsKey(owner, company),
    queryFn: async () => {
      const changes = await readEveryPage(async (page) => {
        guard();
        const result = await getRegisterParticularsChanges(
          apiClient,
          { company, page },
          { ledovaSubmissionGuard: guard },
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
