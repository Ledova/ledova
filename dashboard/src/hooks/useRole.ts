import { useQuery } from '@tanstack/react-query';
import { AccountRole, CACHE_TIMING, canOpen, getUserAccount, useAuth, USER_ACCOUNT_QUERY_KEY } from '@ledova/shared';
import apiClient from '@services/apiClient';

export type { AccountRole };

export function useRole() {
  const { isAuthenticated } = useAuth();

  const query = useQuery({
    queryKey: USER_ACCOUNT_QUERY_KEY,
    queryFn: () => getUserAccount(apiClient),
    enabled: isAuthenticated,
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    gcTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
  });

  const role: AccountRole = query.data?.data.role ?? 'investor';

  return {
    role,
    isInvestor: canOpen(role, 'investing'),
    isCompany: canOpen(role, 'company'),
    isLoading: query.isLoading,
    isKnown: query.data !== undefined,
    isUnavailable: query.isError && query.data === undefined,
    retry: query.refetch,
  };
}
