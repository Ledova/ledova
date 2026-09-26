import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CACHE_TIMING, getAssetSnapshots, getDateRange, type TimeRange } from '@ledova/shared';
import type { ChartDataPoint } from '@ledova/shared';
import apiClient from '@services/apiClient';

export function useAssetPriceHistory(assetUuid: string | null) {
  const [selectedTimeRange, setSelectedTimeRange] = useState<TimeRange>('3M');

  const { start_date, end_date } = useMemo(() => getDateRange(selectedTimeRange), [selectedTimeRange]);

  const snapshotsQuery = useQuery({
    queryKey: ['asset-snapshots', assetUuid, start_date, end_date],
    queryFn: () =>
      getAssetSnapshots(apiClient, assetUuid!, {
        start_date,
        end_date,
        order_by: 'source_timestamp',
      }),
    enabled: !!assetUuid,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
    gcTime: CACHE_TIMING.MEDIUM_GC_TIME,
  });

  const { chartData, periodChangePercent } = useMemo(() => {
    const snapshots = snapshotsQuery.data?.data || [];
    if (snapshots.length === 0) return { chartData: [], periodChangePercent: null };

    const firstPrice = parseFloat(snapshots[0].price) || 0;

    const data: ChartDataPoint[] = snapshots.map(
      (snapshot: { price: string; sourceTimestamp: string }, index: number) => {
        const price = parseFloat(snapshot.price) || 0;

        const changePercent = firstPrice > 0 ? ((price - firstPrice) / firstPrice) * 100 : 0;

        return {
          dayIndex: index,
          date: snapshot.sourceTimestamp,
          price,
          changePercent,
        };
      },
    );

    const lastPrice = parseFloat(snapshots[snapshots.length - 1].price) || 0;
    const overallChange = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : null;

    return { chartData: data, periodChangePercent: overallChange };
  }, [snapshotsQuery.data?.data]);

  return {
    chartData,
    periodChangePercent,
    selectedTimeRange,
    setSelectedTimeRange,
    isLoading: snapshotsQuery.isLoading,
    error: snapshotsQuery.error,
  };
}
