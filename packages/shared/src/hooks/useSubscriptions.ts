import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { CACHE_TIMING } from '../constants/api';
import { getSubscriptions } from '../services/subscriptions';
import { getWallets } from '../services/wallets';
import { assertNextPageAdvances, getNextPageParam, readEveryPage } from '../utils/pagination';
import { useApiClient } from './useApiClient';
import { useLaterPages } from './useLaterPages';

export function useSubscriptions() {
  const apiClient = useApiClient();
  const queryKey = ['subscriptions', 'list'];
  const query = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const { data } = await getSubscriptions(apiClient, pageParam);
      assertNextPageAdvances(pageParam, data);
      return data;
    },
    getNextPageParam,
    initialPageParam: 1,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });
  const pages = useLaterPages(queryKey, query);

  return {
    subscriptions: query.data?.pages.flatMap((page) => page.results) ?? [],
    isLoading: query.isLoading,
    hasError: pages.hasError,
    moreFailed: pages.moreFailed,
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    isRefreshing: query.isFetching,
    retry: () => query.refetch(),
    loadMore: pages.loadMore,
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
