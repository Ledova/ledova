import { useQuery, useQueries } from '@tanstack/react-query';
import {
  getOrders,
  getWallets,
  getWhitelistStatus,
  getWalletBalances,
  BLOCKCHAIN,
  CACHE_TIMING,
  WALLET_VERIFICATION_STATUS,
  readEveryPage,
  useUserPreferences,
  tradingQueryKeys,
  WALLETS_QUERY_KEY,
} from '@ledova/shared';
import type { Wallet, WhitelistStatus } from '@ledova/shared';
import apiClient from '@services/apiClient';

export const TRADING_USER_ORDERS_QUERY_KEY = [...tradingQueryKeys.userOrdersPrefix, 'all'] as const;

export const tradingWalletsQueryKey = (ownerAccountUuid: string | undefined) =>
  [...WALLETS_QUERY_KEY, ownerAccountUuid, 'trading'] as const;

export function isTradingWalletsQueryKey(queryKey: readonly unknown[], ownerAccountUuid: string | undefined) {
  const expected = tradingWalletsQueryKey(ownerAccountUuid);
  return queryKey.length === expected.length && expected.every((part, index) => queryKey[index] === part);
}

export function useUserTradingWallets() {
  const { userAccount, isLoading: isLoadingPortfolio } = useUserPreferences();

  const walletsQuery = useQuery({
    queryKey: tradingWalletsQueryKey(userAccount?.uuid),
    queryFn: async () => ({
      data: { results: await readEveryPage((page) => getWallets(apiClient, { page })) },
    }),
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
    isFetching: walletsQuery.isFetching,
    isLoading: isLoadingPortfolio || walletsQuery.isLoading,
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

  const getStatus = (address: string): WhitelistStatus | undefined => {
    return statusByAddress.get(address.toLowerCase());
  };

  return {
    statusByAddress,
    getStatus,
    isLoading,
    refetch: () => queries.forEach((q) => q.refetch()),
  };
}

function useAllWalletTokenBalances(walletAddresses: string[]) {
  const queries = useQueries({
    queries: walletAddresses.map((address) => ({
      queryKey: tradingQueryKeys.walletBalances(address),
      queryFn: () => getWalletBalances(apiClient, address).then((res) => res.data),
      enabled: !!address,
      staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
      gcTime: CACHE_TIMING.DEFAULT_GC_TIME,
    })),
  });

  const isLoading = queries.some((q) => q.isLoading);
  const error = queries.find((q) => q.error)?.error;

  const tokenWallets = new Map<string, { walletAddress: string; balance: string }[]>();

  queries.forEach((query) => {
    if (query.data && !query.isError) {
      const { walletAddress, balances } = query.data;
      (balances || []).forEach((balance) => {
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
    return tokenWallets.get(tokenUuid) || [];
  };

  return {
    getWalletsWithHoldings,
    isLoading,
    error,
    refetch: () => queries.forEach((q) => q.refetch()),
  };
}

export function useTrading({ walletAddresses = [] }: { walletAddresses?: string[] } = {}) {
  const orders = useQuery({
    queryKey: TRADING_USER_ORDERS_QUERY_KEY,
    queryFn: () => readEveryPage((page) => getOrders(apiClient, { page })),
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    gcTime: CACHE_TIMING.DEFAULT_GC_TIME,
  });
  const tokenBalances = useAllWalletTokenBalances(walletAddresses);
  return {
    userOrders: orders.isError ? [] : (orders.data ?? []),
    isLoadingUserOrders: orders.isLoading,
    ordersError: orders.error,
    refreshOrders: orders.refetch,
    balancesError: tokenBalances.error,
    isLoadingBalances: tokenBalances.isLoading,
    refreshBalances: tokenBalances.refetch,
    getWalletsWithHoldings: tokenBalances.getWalletsWithHoldings,
  };
}
