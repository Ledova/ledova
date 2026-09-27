import type { AxiosInstance } from 'axios';
import type { Wallet } from '../types';
import { getNextPageParam } from '../utils/pagination';
import { summarizeShareHoldings } from '../utils/share-holdings';
import { getWallets } from './wallets';
import { getWalletHoldings } from './wallet-balances';

export async function getShareHoldings(apiClient: AxiosInstance) {
  const wallets: Wallet[] = [];
  let page: number | undefined = 1;

  while (page !== undefined) {
    const { data } = await getWallets(apiClient, { page });
    wallets.push(...data.results);
    const next = getNextPageParam(data);
    if (data.next && (next === undefined || !Number.isInteger(next) || next <= page)) {
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
}
