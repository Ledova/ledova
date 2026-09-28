import { useQuery, useQueries } from '@tanstack/react-query';
import {
  getShareTokens,
  getInvestorEligibility,
  getOrders,
  getWallets,
  getWhitelistStatus,
  getWalletBalances,
  getOrderBook,
  BLOCKCHAIN,
  CACHE_TIMING,
  TRADING_CONFIG,
  WALLET_VERIFICATION_STATUS,
  useUserPreferences,
} from '@ledova/shared';
import type { Wallet, WhitelistStatus, WalletTokenBalance } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { allMarketPages } from './marketData';

export const tradingQueryKeys = {
  tokens: ['trading', 'tokens'] as const,
  walletBalances: (walletAddress: string) => ['trading', 'walletBalances', walletAddress] as const,
  whitelistStatus: (tokenAddress: string, walletAddress: string) =>
    ['trading', 'whitelistStatus', tokenAddress, walletAddress] as const,
};

export function useUserTradingWallets() {
  const { userAccount, isLoading: isLoadingPreferences } = useUserPreferences();

  const walletsQuery = useQuery({
    queryKey: ['wallets', userAccount?.uuid, 'trading'],
    queryFn: async () => ({
      data: { results: await allMarketPages((page) => getWallets(apiClient, page ? { page } : undefined)) },
    }),
    enabled: !!userAccount?.uuid,
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

  return {
    wallets: walletsQuery.isError ? [] : walletsQuery.data?.wallets || ([] as Wallet[]),
    actionWallets: walletsQuery.isError ? [] : walletsQuery.data?.actionWallets || ([] as Wallet[]),
    walletAddresses: (walletsQuery.isError ? [] : walletsQuery.data?.wallets || []).map((w: Wallet) => w.address),
    isLoading: isLoadingPreferences || walletsQuery.isLoading,
    isFetching: walletsQuery.isFetching,
    error: walletsQuery.error,
    refetch: walletsQuery.refetch,
  };
}

export function useWalletsWhitelistStatus(tokenAddress: string | undefined, walletAddresses: string[]) {
  const queries = useQueries({
    queries: walletAddresses.map((address) => ({
      queryKey: tradingQueryKeys.whitelistStatus(tokenAddress ?? '', address),
      queryFn: () => getWhitelistStatus(apiClient, tokenAddress!, address).then((res) => res.data),
      enabled: !!tokenAddress && !!address,
      staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
      gcTime: CACHE_TIMING.DEFAULT_GC_TIME,
      retry: false,
    })),
  });

  const isLoading = queries.some((q) => q.isFetching);

  const statusByAddress = new Map<string, WhitelistStatus>();
  queries.forEach((query, index) => {
    if (query.data && !query.isError && !query.isFetching) {
      statusByAddress.set(walletAddresses[index].toLowerCase(), query.data);
    }
  });

  const isWhitelisted = (address: string): boolean => {
    const status = statusByAddress.get(address.toLowerCase());
    return status?.isWhitelisted ?? false;
  };

  const getStatus = (address: string): WhitelistStatus | undefined => {
    return statusByAddress.get(address.toLowerCase());
  };

  return {
    statusByAddress,
    isWhitelisted,
    getStatus,
    isLoading,
    error: queries.find((q) => q.error)?.error,
    refetch: () => Promise.all(queries.map((q) => q.refetch())),
  };
}

export function useAllWalletTokenBalances(walletAddresses: string[]) {
  const queries = useQueries({
    queries: walletAddresses.map((address) => ({
      queryKey: tradingQueryKeys.walletBalances(address),
      queryFn: () => getWalletBalances(apiClient, address).then((res) => res.data),
      enabled: !!address,
      staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
      gcTime: CACHE_TIMING.DEFAULT_GC_TIME,
    })),
  });

  const isLoading = queries.some((q) => q.isFetching);
  const error = queries.find((q) => q.error)?.error;

  const tokenWallets = new Map<string, { walletAddress: string; balance: string }[]>();

  queries.forEach((query) => {
    if (query.data && !query.isError && !query.isFetching) {
      const { walletAddress, balances } = query.data;
      balances.forEach((balance: WalletTokenBalance) => {
        if (!tokenWallets.has(balance.token)) {
          tokenWallets.set(balance.token, []);
        }
        tokenWallets.get(balance.token)!.push({
          walletAddress,
          balance: balance.balance,
        });
      });
    }
  });

  const getWalletsWithHoldings = (tokenUuid: string): { walletAddress: string; balance: string }[] => {
    return (tokenWallets.get(tokenUuid) || []).filter(
      (item) => /^\d+$/.test(item.balance) && BigInt(item.balance) > 0n,
    );
  };

  return {
    getWalletsWithHoldings,
    isLoading,
    error,
    refetch: () => Promise.all(queries.map((q) => q.refetch())),
  };
}

export function useAllUserOrders() {
  const { userAccount } = useUserPreferences();
  const query = useQuery({
    queryKey: ['trading', 'userOrders', 'all', userAccount?.uuid],
    queryFn: () => allMarketPages((page) => getOrders(apiClient, page ? { page } : undefined)),
    enabled: !!userAccount?.uuid,
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    gcTime: CACHE_TIMING.DEFAULT_GC_TIME,
  });
  return {
    orders: query.isError ? [] : (query.data ?? []),
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useShareTokens() {
  return useQuery({
    queryKey: tradingQueryKeys.tokens,
    queryFn: () => allMarketPages((page) => getShareTokens(apiClient, page)),
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    gcTime: CACHE_TIMING.DEFAULT_GC_TIME,
  });
}

export function useOrderBook(tokenUuid: string | undefined) {
  return useQuery({
    queryKey: ['trading', 'orderBook', tokenUuid] as const,
    queryFn: () => getOrderBook(apiClient, tokenUuid!).then((res) => res.data),
    enabled: !!tokenUuid,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
    refetchInterval: TRADING_CONFIG.ORDER_BOOK_FALLBACK_INTERVAL,
  });
}

export function useInvestorEligibilityQuery() {
  return useQuery({
    queryKey: ['investor-eligibility'],
    queryFn: () => getInvestorEligibility(apiClient).then((res) => res.data),
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });
}
