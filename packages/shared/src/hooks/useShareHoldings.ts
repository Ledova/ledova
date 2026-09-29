import { useQuery } from '@tanstack/react-query';

import { CACHE_TIMING } from '../constants/api';
import { getShareHoldings } from '../services/share-holdings';
import { useApiClient } from './useApiClient';

export function useShareHoldings() {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: ['wallets', 'share-holdings'],
    queryFn: () => getShareHoldings(apiClient),
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
    gcTime: CACHE_TIMING.MEDIUM_GC_TIME,
  });
}
