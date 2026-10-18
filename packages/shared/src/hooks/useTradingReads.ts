import { useQuery, useQueries } from '@tanstack/react-query';
import { BLOCKCHAIN, CACHE_TIMING, WALLET_VERIFICATION_STATUS } from '../constants';
import { getOrders, getWalletBalances, getWhitelistStatus } from '../services/trading';
import { getWallets } from '../services/wallets';
import type { Wallet } from '../types';
import { readEveryPage } from '../utils/pagination';
import { useApiClient } from './useApiClient';
import { tradingQueryKeys } from './useMarket';
import { WALLETS_QUERY_KEY } from './useSubscriptions';

export const TRADING_USER_ORDERS_QUERY_KEY = [...tradingQueryKeys.userOrdersPrefix, 'all'] as const;

export const tradingUserOrdersQueryKey = (ownerAccountUuid: string | undefined) =>
  [...TRADING_USER_ORDERS_QUERY_KEY, ownerAccountUuid] as const;

export const tradingWalletsQueryKey = (ownerAccountUuid: string | undefined) =>
  [...WALLETS_QUERY_KEY, ownerAccountUuid, 'trading'] as const;

export function useTradingWalletsQuery(ownerAccountUuid: string | undefined, options: { enabled?: boolean } = {}) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: tradingWalletsQueryKey(ownerAccountUuid),
    queryFn: async () => ({
      data: { results: await readEveryPage((page) => getWallets(apiClient, { page })) },
    }),
    ...options,
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    gcTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
    select: (data) => ({
      wallets: data.data.results.filter(
        (w: Wallet) =>
          w.verificationStatus === WALLET_VERIFICATION_STATUS.VERIFIED &&
          (w.chain === BLOCKCHAIN.ETHEREUM || w.chain === BLOCKCHAIN.BASE),
      ),
      actionWallets: data.data.results.filter(
        (wallet: Wallet) => wallet.chain === BLOCKCHAIN.ETHEREUM || wallet.chain === BLOCKCHAIN.BASE,
      ),
    }),
  });
}

export function useTradingWhitelistQueries(tokenAddress: string | undefined, walletAddresses: string[]) {
  const apiClient = useApiClient();
  return useQueries({
    queries: walletAddresses.map((address) => ({
      queryKey: tradingQueryKeys.whitelistStatus(tokenAddress ?? '', address),
      queryFn: () => getWhitelistStatus(apiClient, tokenAddress!, address).then((res) => res.data),
      enabled: !!tokenAddress && !!address,
      staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
      gcTime: CACHE_TIMING.DEFAULT_GC_TIME,
      retry: false,
    })),
  });
}

export function useTradingBalanceQueries(walletAddresses: string[]) {
  const apiClient = useApiClient();
  return useQueries({
    queries: walletAddresses.map((address) => ({
      queryKey: tradingQueryKeys.walletBalances(address),
      queryFn: () => getWalletBalances(apiClient, address).then((res) => res.data),
      enabled: !!address,
      staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
      gcTime: CACHE_TIMING.DEFAULT_GC_TIME,
    })),
  });
}

export function useTradingUserOrdersQuery(
  queryKey:
    typeof TRADING_USER_ORDERS_QUERY_KEY | ReturnType<typeof tradingUserOrdersQueryKey> = TRADING_USER_ORDERS_QUERY_KEY,
  options: { enabled?: boolean } = {},
) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey,
    queryFn: () => readEveryPage((page) => getOrders(apiClient, { page })),
    ...options,
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    gcTime: CACHE_TIMING.DEFAULT_GC_TIME,
  });
}
