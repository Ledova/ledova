import { useQuery } from '@tanstack/react-query';
import { CACHE_TIMING, getShareHoldings } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';

export function useShareHoldings() {
  return useQuery({
    queryKey: ['wallets', 'share-holdings'],
    queryFn: () => getShareHoldings(apiClient),
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
    gcTime: CACHE_TIMING.MEDIUM_GC_TIME,
  });
}
