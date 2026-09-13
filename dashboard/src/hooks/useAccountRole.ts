import { useQuery } from '@tanstack/react-query';
import { CACHE_TIMING, getUserAccount } from '@ledova/shared';
import apiClient from '@services/apiClient';

export type AccountRole = 'investor' | 'company' | 'both';

export function useAccountRole() {
  const query = useQuery({
    queryKey: ['userAccount'],
    queryFn: () => getUserAccount(apiClient),
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
  });

  const role: AccountRole = query.data?.data.role ?? 'investor';

  return {
    role,
    isCompany: role === 'company' || role === 'both',
    isInvestor: role === 'investor' || role === 'both',
    isLoading: query.isLoading,
  };
}
