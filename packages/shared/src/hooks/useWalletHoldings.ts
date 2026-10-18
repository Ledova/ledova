import { useQuery } from '@tanstack/react-query';
import type { AxiosResponse } from 'axios';
import { CACHE_TIMING } from '../constants';
import { getWalletHoldings } from '../services/wallet-balances';
import type { WalletHolding } from '../types';
import { useApiClient } from './useApiClient';

export function walletHoldingsKey(uuid: string | undefined) {
  return ['wallet-holdings', uuid];
}

export function useWalletHoldings<T = AxiosResponse<WalletHolding[]>>(
  wallet: () => { uuid: string } | null | undefined,
  select?: (data: AxiosResponse<WalletHolding[]>) => T,
) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: walletHoldingsKey(wallet()?.uuid),
    queryFn: () => getWalletHoldings(apiClient, wallet()!.uuid),
    enabled: !!wallet()?.uuid,
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    ...(select ? { select } : {}),
  });
}
