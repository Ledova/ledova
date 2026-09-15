import { useQuery } from '@tanstack/react-query';
import { CACHE_TIMING, getSwapOrders } from '@ledova/shared';
import type { SwapOrder } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';

export function useSwapOrdersMulti(walletAddresses: string[]) {
  return useQuery({
    queryKey: ['trading', 'swaps', 'multi', walletAddresses],
    queryFn: async () => {
      if (walletAddresses.length === 0) return [] as SwapOrder[];
      const results = await Promise.all(
        walletAddresses.map((addr) => getSwapOrders(apiClient, addr).then((res) => res.data.results)),
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
