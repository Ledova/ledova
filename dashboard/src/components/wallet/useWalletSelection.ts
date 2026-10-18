import { useQuery } from '@tanstack/react-query';
import { getChainConfig, getWallets, readEveryPage, WALLETS_QUERY_KEY } from '@ledova/shared';
import apiClient from '@services/apiClient';

export function useWalletSelection(isOpen: boolean) {
  const walletsQuery = useQuery({
    queryKey: [...WALLETS_QUERY_KEY, { verification_status: 'VERIFIED', ordering: 'signing_preference' }],
    queryFn: () =>
      readEveryPage((page) =>
        getWallets(apiClient, {
          verification_status: 'VERIFIED',
          ordering: 'signing_preference',
          page,
        }),
      ),
    enabled: isOpen,
  });

  const wallets = (walletsQuery.data ?? []).filter((wallet) => getChainConfig(wallet.chain)?.isActive);
  return { walletsQuery, wallets };
}
