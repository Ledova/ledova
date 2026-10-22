import { useQuery } from '@tanstack/react-query';
import { getRegisterReconciliations, type OrderSubmissionOwner } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { READ_TIMING, registerKey } from '@hooks/useRegisterAccess';
import { guarded } from '@pages/company/ledger/shared/registerReads';

export function reconciliationKey(owner: OrderSubmissionOwner, token: string) {
  return [...registerKey(owner), 'reconciliation', token];
}

export function useLatestReconciliation(owner: OrderSubmissionOwner, token: string, guard: () => void) {
  return useQuery({
    queryKey: reconciliationKey(owner, token),
    queryFn: async () => {
      const { data } = await guarded(guard, () =>
        getRegisterReconciliations(apiClient, { token, page: 1 }, { ledovaSubmissionGuard: guard }),
      );
      const latest = data.results[0] ?? null;
      if (latest && latest.token !== token) throw new Error('The reconciliation did not identify this share class.');
      return latest;
    },
    ...READ_TIMING,
  });
}
