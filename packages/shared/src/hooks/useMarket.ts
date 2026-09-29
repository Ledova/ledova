import { useQuery } from '@tanstack/react-query';

import { CACHE_TIMING } from '../constants/api';
import { TRADING_CONFIG } from '../constants/business/trading';
import { getInvestorEligibility } from '../services/investorClassifications';
import { getOrderBook, getShareTokens } from '../services/trading';
import { readEveryPage } from '../utils/pagination';
import { useApiClient } from './useApiClient';

export function useShareTokens() {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: ['trading', 'tokens'],
    queryFn: () => readEveryPage((page) => getShareTokens(apiClient, page)),
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    gcTime: CACHE_TIMING.DEFAULT_GC_TIME,
  });
}

export function useOrderBook(tokenUuid: string | undefined) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: ['trading', 'orderBook', tokenUuid] as const,
    queryFn: () => getOrderBook(apiClient, tokenUuid!).then((res) => res.data),
    enabled: !!tokenUuid,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
    refetchInterval: TRADING_CONFIG.ORDER_BOOK_FALLBACK_INTERVAL,
  });
}

export function useInvestorEligibilityQuery() {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: ['investor-eligibility'],
    queryFn: () => getInvestorEligibility(apiClient),
    select: (response) => response.data,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });
}
