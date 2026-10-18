import { useQuery } from '@tanstack/react-query';
import { getRegisterImports, readEveryPage, type OrderSubmissionOwner } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { READ_TIMING, registerKey } from '@hooks/useRegisterAccess';

export function importsKey(owner: OrderSubmissionOwner, token: string) {
  return [...registerKey(owner), 'imports', token];
}

export function useRegisterImports(owner: OrderSubmissionOwner, token: string, guard: () => void, enabled = true) {
  return useQuery({
    queryKey: importsKey(owner, token),
    enabled,
    queryFn: async () => {
      const imports = await readEveryPage(async (page) => {
        guard();
        const result = await getRegisterImports(apiClient, { token, page }, { ledovaSubmissionGuard: guard });
        guard();
        return result;
      });
      if (imports.some((proposal) => proposal.token !== token))
        throw new Error('The imports did not identify this share class.');
      return [...imports].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    },
    ...READ_TIMING,
  });
}
