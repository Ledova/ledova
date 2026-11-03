import { useQuery } from '@tanstack/react-query';
import { READ_TIMING } from '../constants/api';
import { getRegisterImports } from '../services/register-imports';
import { readEveryPage } from '../utils/pagination';
import { useApiClient } from './useApiClient';
import { registerKey } from './useCompanyOwnership';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

export function importsKey(owner: OrderSubmissionOwner, token: string) {
  return [...registerKey(owner), 'imports', token];
}

export function useRegisterImports(
  owner: OrderSubmissionOwner,
  token: string,
  guard: () => void,
  enabled = true,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: importsKey(owner, token),
    enabled,
    queryFn: async () => {
      const imports = await readEveryPage(async (page) => {
        guard();
        const result = await getRegisterImports(
          apiClient,
          { token, page },
          { ...session?.requestConfig(), ledovaSubmissionGuard: guard },
        );
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
