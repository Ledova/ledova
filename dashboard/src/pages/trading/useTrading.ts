import {
  useUserPreferences,
  tradingWalletsQueryKey,
  useTradingWalletsQuery,
  useTradingWhitelistQueries,
  useTradingBalanceQueries,
  useTradingUserOrdersQuery,
} from '@ledova/shared';
import type { Wallet, WhitelistStatus } from '@ledova/shared';
export { TRADING_USER_ORDERS_QUERY_KEY, tradingWalletsQueryKey } from '@ledova/shared';

export function isTradingWalletsQueryKey(queryKey: readonly unknown[], ownerAccountUuid: string | undefined) {
  const expected = tradingWalletsQueryKey(ownerAccountUuid);
  return queryKey.length === expected.length && expected.every((part, index) => queryKey[index] === part);
}

export function useUserTradingWallets() {
  const { userAccount, isLoading: isLoadingPortfolio } = useUserPreferences();

  const walletsQuery = useTradingWalletsQuery(userAccount?.uuid);

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
  const queries = useTradingWhitelistQueries(tokenAddress, walletAddresses);

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
  const queries = useTradingBalanceQueries(walletAddresses);

  const isLoading = queries.some((q) => q.isLoading);
  const isFetching = queries.some((q) => q.isFetching);
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
    isFetching,
    error,
    refetch: () => queries.forEach((q) => q.refetch()),
  };
}

export function useTrading({ walletAddresses = [] }: { walletAddresses?: string[] } = {}) {
  const orders = useTradingUserOrdersQuery();
  const tokenBalances = useAllWalletTokenBalances(walletAddresses);
  return {
    userOrders: orders.isError ? [] : (orders.data ?? []),
    isLoadingUserOrders: orders.isLoading,
    isFetchingOrders: orders.isFetching,
    ordersError: orders.error,
    refreshOrders: orders.refetch,
    balancesError: tokenBalances.error,
    isLoadingBalances: tokenBalances.isLoading,
    isFetchingBalances: tokenBalances.isFetching,
    refreshBalances: tokenBalances.refetch,
    getWalletsWithHoldings: tokenBalances.getWalletsWithHoldings,
  };
}
