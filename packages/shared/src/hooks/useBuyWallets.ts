import { useQuery } from '@tanstack/react-query';
import { getWallets } from '../services/wallets';
import type { BuyableAssetConfig } from '../types';
import { readEveryPage } from '../utils/pagination';
import { useApiClient } from './useApiClient';
import { WALLETS_QUERY_KEY } from './useSubscriptions';

export function buyWalletsKey(userAccountUuid: string | undefined, chain: BuyableAssetConfig['chain'] | undefined) {
  return [
    ...WALLETS_QUERY_KEY,
    userAccountUuid,
    { chain, verification_status: 'VERIFIED', ordering: 'signing_preference' },
  ];
}

export function useBuyWallets(
  userAccountUuid: string | undefined,
  asset: () => Pick<BuyableAssetConfig, 'chain'> | null | undefined,
  enabled: boolean,
) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: buyWalletsKey(userAccountUuid, asset()?.chain),
    queryFn: () =>
      readEveryPage((page) =>
        getWallets(apiClient, {
          chain: asset()!.chain,
          verification_status: 'VERIFIED',
          ordering: 'signing_preference',
          page,
        }),
      ),
    enabled,
  });
}
