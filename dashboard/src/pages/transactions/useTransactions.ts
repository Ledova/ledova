import { useState } from 'react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  assertNextPageAdvances,
  getTransactions,
  getTransactionsNextPage,
  getWallets,
  readEveryPage,
} from '@ledova/shared';
import type { TransactionQueryParams } from '@ledova/shared';
import apiClient from '@services/apiClient';

export type TransactionFilters = Pick<
  TransactionQueryParams,
  'wallet' | 'direction' | 'chain' | 'start_date' | 'end_date'
>;

export function useTransactions() {
  const [filters, setFilters] = useState<TransactionFilters>({});
  const [appliedFilters, setAppliedFilters] = useState<TransactionFilters>({});

  const walletsQuery = useQuery({
    queryKey: ['wallets', 'activity-filter'],
    queryFn: () => readEveryPage((page) => getWallets(apiClient, { page })),
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
  });

  const query = useInfiniteQuery({
    queryKey: ['transactions', appliedFilters],
    queryFn: async ({ pageParam }) => {
      const response = await getTransactions(apiClient, {
        ...appliedFilters,
        start_date: appliedFilters.start_date
          ? new Date(`${appliedFilters.start_date}T00:00:00`).toISOString()
          : undefined,
        end_date: appliedFilters.end_date
          ? new Date(`${appliedFilters.end_date}T23:59:59.999`).toISOString()
          : undefined,
        page: pageParam,
      });
      assertNextPageAdvances(pageParam, response.data);
      return response;
    },
    getNextPageParam: getTransactionsNextPage,
    initialPageParam: 1,
    staleTime: CACHE_TIMING.VERY_SHORT_STALE_TIME,
    gcTime: CACHE_TIMING.MEDIUM_GC_TIME,
  });

  return {
    transactions: query.data?.pages.flatMap((page) => page.data.results) ?? [],
    wallets: walletsQuery.isError ? [] : (walletsQuery.data ?? []),
    walletsLoading: walletsQuery.isLoading,
    walletsFailed: walletsQuery.isError,
    walletsRefreshing: walletsQuery.isFetching,
    retryWallets: () => walletsQuery.refetch(),
    isLoading: query.isLoading,
    hasError: query.isError && !query.isFetchNextPageError,
    moreFailed: query.isFetchNextPageError,
    isRefreshing: query.isFetching,
    retry: () => query.refetch(),
    isLoadingMore: query.isFetchingNextPage,
    filters,
    appliedFilters,
    hasActiveFilters: Object.values(appliedFilters).some((value) => value !== undefined),
    totalCount: query.data?.pages[0]?.data.count ?? 0,
    hasNextPage: query.hasNextPage,
    applyFilters: () => setAppliedFilters(filters),
    updateFilters: setFilters,
    clearFilters: () => {
      setFilters({});
      setAppliedFilters({});
    },
    loadMore: () => query.fetchNextPage(),
  };
}
