import type { AxiosInstance } from 'axios';
import { readEveryPage } from '../utils/pagination';
import { summarizeShareHoldings } from '../utils/share-holdings';
import { getWallets } from './wallets';
import { getWalletHoldings } from './wallet-balances';

export async function getShareHoldings(apiClient: AxiosInstance) {
  const wallets = await readEveryPage((page) => getWallets(apiClient, { page }));

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
