import {
  useUserPreferences,
  tradingUserOrdersQueryKey,
  tradingWalletsQueryKey,
  useTradingWalletsQuery,
  useTradingWhitelistQueries,
  useTradingBalanceQueries,
  useTradingUserOrdersQuery,
} from '@ledova/shared';
import type { Wallet, WhitelistStatus, WalletTokenBalance } from '@ledova/shared';
export { tradingUserOrdersQueryKey, tradingWalletsQueryKey } from '@ledova/shared';

export function isTradingWalletsQueryKey(queryKey: readonly unknown[], ownerAccountUuid: string | undefined) {
  const expected = tradingWalletsQueryKey(ownerAccountUuid);
  return expected.every((part, index) => queryKey[index] === part);
}

export function useUserTradingWallets() {
  const { userAccount, isLoading: isLoadingPreferences } = useUserPreferences();

  const walletsQuery = useTradingWalletsQuery(userAccount?.uuid, {
    enabled: !!userAccount?.uuid,
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
  const queries = useTradingWhitelistQueries(tokenAddress, walletAddresses);

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
  const queries = useTradingBalanceQueries(walletAddresses);

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
  const query = useTradingUserOrdersQuery(tradingUserOrdersQueryKey(userAccount?.uuid), {
    enabled: !!userAccount?.uuid,
  });
  return {
    orders: query.isError ? [] : (query.data ?? []),
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}
