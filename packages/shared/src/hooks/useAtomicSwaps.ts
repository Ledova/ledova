import { useQuery } from '@tanstack/react-query';

import { CACHE_TIMING } from '../constants/api';
import { getSwapOrders } from '../services/trading';
import type { SwapOrder } from '../types';
import { readEveryPage } from '../utils/pagination';
import { useApiClient } from './useApiClient';

export function useSwapOrdersMulti(walletAddresses: string[]) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: ['trading', 'swaps', 'multi', walletAddresses],
    queryFn: async () => {
      if (walletAddresses.length === 0) return [] as SwapOrder[];
      const results = await Promise.all(
        walletAddresses.map((addr) => readEveryPage((page) => getSwapOrders(apiClient, addr, page))),
      );
      const swapMap = new Map<string, SwapOrder>();
      results.flat().forEach((swap) => {
        if (!swapMap.has(swap.uuid)) {
          swapMap.set(swap.uuid, swap);
        }
      });
      return Array.from(swapMap.values());
    },
    enabled: walletAddresses.length > 0,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
    gcTime: CACHE_TIMING.DEFAULT_GC_TIME,
  });
}
