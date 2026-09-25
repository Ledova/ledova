import { useQuery } from '@tanstack/react-query';
import { AccountRole, CACHE_TIMING, getUserAccount } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { useAuth } from './useAuth';

export type { AccountRole };

export function useRole() {
  const { isAuthenticated } = useAuth();

  const query = useQuery({
    queryKey: ['userAccount'],
    queryFn: () => getUserAccount(apiClient),
    enabled: isAuthenticated,
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    gcTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
  });

  const role: AccountRole = query.data?.data.role ?? 'investor';

  return {
    role,
    isInvestor: role === 'investor' || role === 'both',
    isCompany: role === 'company' || role === 'both',
    isLoading: query.isLoading,
  };
}
