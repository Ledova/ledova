import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { CACHE_TIMING } from '../constants/api';
import { getSubscriptions } from '../services/subscriptions';
import { getWallets } from '../services/wallets';
import { assertNextPageAdvances, getNextPageParam, readEveryPage } from '../utils/pagination';
import { useApiClient } from './useApiClient';

export function useSubscriptions() {
  const apiClient = useApiClient();
  const query = useInfiniteQuery({
    queryKey: ['subscriptions', 'list'],
    queryFn: async ({ pageParam }) => {
      const { data } = await getSubscriptions(apiClient, pageParam);
      assertNextPageAdvances(pageParam, data);
      return data;
    },
    getNextPageParam,
    initialPageParam: 1,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  return {
    subscriptions: query.data?.pages.flatMap((page) => page.results) ?? [],
    isLoading: query.isLoading,
    hasError: query.isError && !query.isFetchNextPageError,
    moreFailed: query.isFetchNextPageError,
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    isRefreshing: query.isFetching,
    retry: () => query.refetch(),
    loadMore: () => query.fetchNextPage(),
  };
}

export function useSubscribableWallets(enabled: boolean) {
  const apiClient = useApiClient();
  const query = useQuery({
    queryKey: ['wallets', 'base-verified', 'complete'],
    queryFn: () =>
      readEveryPage((page) => getWallets(apiClient, { chain: 'base', verification_status: 'VERIFIED', page })),
    enabled,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  return {
    wallets: query.data ?? [],
    isLoading: query.isLoading,
    hasError: query.isError,
    isRefreshing: query.isFetching,
    retry: () => query.refetch(),
  };
}
