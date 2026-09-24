import { useInfiniteQuery } from '@tanstack/react-query';
import { CACHE_TIMING } from '../constants/api';
import { DIVIDEND_FILTERS } from '../constants/business/publications';
import { getPublications, getPublicationsNextPage } from '../services/publications';
import { useApiClient } from './useApiClient';

export const DIVIDENDS_QUERY_KEY = ['publications', 'dividends'] as const;

export function useDividends() {
  const apiClient = useApiClient();
  const listing = useInfiniteQuery({
    queryKey: DIVIDENDS_QUERY_KEY,
    queryFn: ({ pageParam }) => getPublications(apiClient, pageParam, DIVIDEND_FILTERS),
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
