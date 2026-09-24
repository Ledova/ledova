import { useState, useMemo, useCallback } from 'react';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPortfolioSnapshotsTimeSeries,
  portfolioSnapshotPoints,
  getWallets,
  getTransactions,
  getTransactionsNextPage,
  getAssetByUuid,
  getAssets,
  getFavouriteAssets,
  CACHE_TIMING,
  PUBLICATION_SUMMARY_QUERY_KEY,
  TimeRange,
  TIME_RANGES,
  BLOCKCHAIN,
  getDateRange,
  calculateWalletTotals,
  filterWalletsByChain,
} from '@ledova/shared';
import type { FavouriteAsset } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { usePortfolio } from '../portfolio/usePortfolio';

export const useHome = () => {
  const queryClient = useQueryClient();
  const { selectedPortfolio, userAccount, isLoading: preferencesLoading } = useUserPreferences();
  const [selectedTimeRange, setSelectedTimeRange] = useState<TimeRange>('3M');
  const [selectedAssetUuid, setSelectedAssetUuid] = useState<string | null>(null);
  const { start_date, end_date } = getDateRange(selectedTimeRange);

  const holdings = usePortfolio();

  const assetQuery = useQuery({
    queryKey: ['asset', selectedAssetUuid],
    queryFn: () => getAssetByUuid(apiClient, selectedAssetUuid!),
    enabled: !!selectedAssetUuid,
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
  });

  const walletsQuery = useQuery({
    queryKey: ['wallets', userAccount?.uuid],
    queryFn: () => getWallets(apiClient),
    enabled: !!userAccount?.uuid,
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    gcTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
  });

  const walletsList = walletsQuery.data?.data.results || [];

  const btcWallets = useMemo(() => filterWalletsByChain(walletsList, BLOCKCHAIN.BITCOIN), [walletsList]);
  const ethWallets = useMemo(() => filterWalletsByChain(walletsList, BLOCKCHAIN.ETHEREUM), [walletsList]);
  const baseWallets = useMemo(() => filterWalletsByChain(walletsList, BLOCKCHAIN.BASE), [walletsList]);
  const walletTotals = useMemo(() => calculateWalletTotals(walletsList), [walletsList]);

  const transactionsQuery = useInfiniteQuery({
    queryKey: ['home-transactions'],
    queryFn: ({ pageParam = 1 }) => getTransactions(apiClient, { page: pageParam }),
    getNextPageParam: getTransactionsNextPage,
    initialPageParam: 1,
    staleTime: CACHE_TIMING.VERY_SHORT_STALE_TIME,
    gcTime: CACHE_TIMING.MEDIUM_GC_TIME,
  });

  const marketAssetsQuery = useQuery({
    queryKey: ['home-market-assets'],
    queryFn: () => getAssets(apiClient, { is_active: true }),
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    gcTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
  });

  const marketAssets = marketAssetsQuery.data?.data?.results ?? [];

  const favouritesQuery = useQuery({
    queryKey: ['favouriteAssets'],
    queryFn: () => getFavouriteAssets(apiClient),
    enabled: !!userAccount?.uuid,
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    gcTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
  });

  const favouriteAssetUuids = useMemo<Set<string>>(
    () => new Set<string>((favouritesQuery.data?.data?.results ?? []).map((f: FavouriteAsset) => f.asset.uuid)),
    [favouritesQuery.data],
  );

  const transactionsList = transactionsQuery.data?.pages.flatMap((page) => page.data?.results || []) || [];
  const transactionsCount = transactionsQuery.data?.pages[0]?.data?.count || 0;

  const loadMoreTransactions = useCallback(() => {
    if (transactionsQuery.hasNextPage && !transactionsQuery.isFetchingNextPage) {
      transactionsQuery.fetchNextPage();
    }
  }, [transactionsQuery]);

  const portfolioSnapshotsQuery = useQuery({
    queryKey: ['portfolio-snapshots', selectedPortfolio?.uuid, start_date, end_date],
    queryFn: () =>
      getPortfolioSnapshotsTimeSeries(apiClient, selectedPortfolio!.uuid, {
        start_date,
        end_date,
        order_by: 'snapshot_date',
      }),
    enabled: !!selectedPortfolio?.uuid,
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    gcTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
    select: (response) => portfolioSnapshotPoints(response.data || []),
  });

  const isHomeLoading = preferencesLoading || portfolioSnapshotsQuery.isLoading;

  const invalidateAll = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['portfolio-snapshots'] }),
      queryClient.invalidateQueries({ queryKey: ['wallets'] }),
      queryClient.invalidateQueries({ queryKey: ['home-transactions'] }),
      queryClient.invalidateQueries({ queryKey: ['home-market-assets'] }),
      queryClient.invalidateQueries({ queryKey: ['favouriteAssets'] }),
      queryClient.invalidateQueries({ queryKey: ['holdings'] }),
      queryClient.invalidateQueries({ queryKey: PUBLICATION_SUMMARY_QUERY_KEY }),
    ]);
  }, [queryClient]);

  return {
    invalidateAll,
    isLoading: isHomeLoading,
    error: portfolioSnapshotsQuery.error || null,
    performanceTimeRange: selectedTimeRange,
    setPerformanceTimeRange: setSelectedTimeRange,
    performanceChartData: portfolioSnapshotsQuery.data || null,
    timeRanges: TIME_RANGES,
    holdings,
    selectedAsset: assetQuery.data?.data || null,
    setSelectedAssetUuid,
    wallets: {
      list: walletsList,
      btcWalletsCount: btcWallets.length,
      ethWalletsCount: ethWallets.length,
      baseWalletsCount: baseWallets.length,
      totals: walletTotals,
      isLoading: walletsQuery.isLoading,
    },
    marketAssets,
    favouriteAssetUuids,
    isMarketAssetsLoading: marketAssetsQuery.isLoading,
    transactions: {
      list: transactionsList,
      totalCount: transactionsCount,
      isLoading: transactionsQuery.isLoading,
      isLoadingMore: transactionsQuery.isFetchingNextPage,
      hasNextPage: transactionsQuery.hasNextPage ?? false,
      loadMore: loadMoreTransactions,
    },
  };
};
