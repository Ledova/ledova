import { useInfiniteQuery } from '@tanstack/react-query';
import { CACHE_TIMING } from '../constants/api';
import { getPublications, getPublicationsNextPage } from '../services/publications';
import { useApiClient } from './useApiClient';

export const DIVIDENDS_QUERY_KEY = ['publications', 'distribution'] as const;

export function useDividends() {
  const apiClient = useApiClient();
  const listing = useInfiniteQuery({
    queryKey: DIVIDENDS_QUERY_KEY,
    queryFn: ({ pageParam }) => getPublications(apiClient, pageParam, 'distribution'),
    getNextPageParam: getPublicationsNextPage,
    initialPageParam: 1,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  return {
    dividends: listing.data?.pages.flatMap((page) => page.data?.results ?? []) ?? [],
    isLoading: listing.isLoading,
    listFailed: listing.isError && !listing.data,
    retry: () => void listing.refetch(),
    hasMore: listing.hasNextPage,
    isLoadingMore: listing.isFetchingNextPage,
    loadMore: () => void listing.fetchNextPage(),
  };
}
