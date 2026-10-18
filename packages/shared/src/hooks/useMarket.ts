import { useQuery } from '@tanstack/react-query';

import { CACHE_TIMING } from '../constants/api';
import { TRADING_CONFIG } from '../constants/business/trading';
import type { TradingEventType } from '../generated/api';
import { getInvestorReadiness } from '../services/investorClassifications';
import { getOrderBook, getShareTokens } from '../services/trading';
import { readEveryPage } from '../utils/pagination';
import { useApiClient } from './useApiClient';

export const TRADING_QUERY_KEY = ['trading'] as const;

export const tradingQueryKeys = {
  tokens: [...TRADING_QUERY_KEY, 'tokens'] as const,
  orderBooks: [...TRADING_QUERY_KEY, 'orderBook'] as const,
  orderBook: (tokenUuid: string | undefined) => [...TRADING_QUERY_KEY, 'orderBook', tokenUuid] as const,
  walletBalancesPrefix: [...TRADING_QUERY_KEY, 'walletBalances'] as const,
  walletBalances: (walletAddress: string) => [...TRADING_QUERY_KEY, 'walletBalances', walletAddress] as const,
  whitelistStatus: (tokenAddress: string, walletAddress: string) =>
    [...TRADING_QUERY_KEY, 'whitelistStatus', tokenAddress, walletAddress] as const,
  userOrdersPrefix: [...TRADING_QUERY_KEY, 'userOrders'] as const,
  swaps: [...TRADING_QUERY_KEY, 'swaps'] as const,
  swapOrdersMulti: (walletAddresses: string[]) => [...TRADING_QUERY_KEY, 'swaps', 'multi', walletAddresses] as const,
};

export const INVESTOR_ELIGIBILITY_QUERY_KEY = ['investor-eligibility'] as const;

export const TRADING_EVENT_INVALIDATION_MAP: Record<TradingEventType, string[][]> = {
  order_created: [[...tradingQueryKeys.orderBooks], [...tradingQueryKeys.userOrdersPrefix]],
  order_cancelled: [[...tradingQueryKeys.orderBooks], [...tradingQueryKeys.userOrdersPrefix]],
  order_modified: [[...tradingQueryKeys.orderBooks], [...tradingQueryKeys.userOrdersPrefix]],
  order_listed: [[...tradingQueryKeys.orderBooks], [...tradingQueryKeys.userOrdersPrefix]],
  order_held: [[...tradingQueryKeys.orderBooks], [...tradingQueryKeys.userOrdersPrefix]],
  order_matched: [
    [...tradingQueryKeys.orderBooks],
    [...tradingQueryKeys.userOrdersPrefix],
    [...tradingQueryKeys.swaps],
  ],
  swap_signed: [[...tradingQueryKeys.swaps]],
  swap_completed: [
    [...tradingQueryKeys.orderBooks],
    [...tradingQueryKeys.swaps],
    [...tradingQueryKeys.userOrdersPrefix],
    [...tradingQueryKeys.walletBalancesPrefix],
  ],
  swap_failed: [[...tradingQueryKeys.orderBooks], [...tradingQueryKeys.swaps], [...tradingQueryKeys.userOrdersPrefix]],
  swap_expired: [[...tradingQueryKeys.orderBooks], [...tradingQueryKeys.userOrdersPrefix], [...tradingQueryKeys.swaps]],
};

export function useShareTokens() {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: tradingQueryKeys.tokens,
    queryFn: () => readEveryPage((page) => getShareTokens(apiClient, page)),
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    gcTime: CACHE_TIMING.DEFAULT_GC_TIME,
  });
}

export function useOrderBook(tokenUuid: string | undefined) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: tradingQueryKeys.orderBook(tokenUuid),
    queryFn: () => getOrderBook(apiClient, tokenUuid!).then((res) => res.data),
    enabled: !!tokenUuid,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
    refetchInterval: TRADING_CONFIG.ORDER_BOOK_FALLBACK_INTERVAL,
  });
}

export function useInvestorReadinessQuery() {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: INVESTOR_ELIGIBILITY_QUERY_KEY,
    queryFn: () => getInvestorReadiness(apiClient),
    select: (response) => response.data,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });
}
