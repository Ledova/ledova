import { useQuery } from '@tanstack/react-query';
import { CACHE_TIMING, getNextPageParam, getWalletHoldings, getWallets, type Wallet } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { summarizeShareHoldings } from '../shareHoldings';

export function useShareHoldings() {
  return useQuery({
    queryKey: ['wallets', 'share-holdings'],
    queryFn: async () => {
      const wallets: Wallet[] = [];
      let page: number | undefined = 1;

      while (page !== undefined) {
        const { data } = await getWallets(apiClient, { page });
        wallets.push(...data.results);
        const next = getNextPageParam(data);
        if (next !== undefined && (!Number.isInteger(next) || next <= page)) {
          throw new Error('Wallet pagination did not advance');
        }
        page = next;
      }

      const holdings = await Promise.all(
        wallets.map(async (wallet) => {
          const { data } = await getWalletHoldings(apiClient, wallet.uuid);
          return data.map((holding) => ({
            ...holding,
            walletInfo: {
              uuid: wallet.uuid,
              name: wallet.name,
              address: wallet.address,
              chain: wallet.chain,
            },
          }));
        }),
      );

      return summarizeShareHoldings(holdings.flat());
    },
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
    gcTime: CACHE_TIMING.MEDIUM_GC_TIME,
  });
}
