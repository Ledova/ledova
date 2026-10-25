import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { assertNextPageAdvances, getNextPageParam, useLaterPages, type PaginatedResponse } from '@ledova/shared';
import { READ_TIMING } from '@hooks/useRegisterAccess';
import { firstOfEach } from '@pages/company/ledger/shared/registerReads';

export function useRecordFeed<Row extends { uuid: string }>(
  queryKey: QueryKey,
  read: (page: number) => Promise<{ data: PaginatedResponse<Row> }>,
  enabled = true,
  policy: { paused?: boolean } = {},
) {
  const query = useInfiniteQuery({
    queryKey,
    enabled: enabled && !policy.paused,
    ...(policy.paused === undefined
      ? {}
      : { refetchOnWindowFocus: !policy.paused, refetchOnReconnect: !policy.paused }),
    queryFn: async ({ pageParam }) => {
      const { data } = await read(pageParam);
      assertNextPageAdvances(pageParam, data);
      return data;
    },
    getNextPageParam,
    initialPageParam: 1,
    ...READ_TIMING,
  });
  const pages = useLaterPages(queryKey, query);
  return {
    rows: firstOfEach(query.data?.pages.flatMap((page) => page.results) ?? [], ({ uuid }) => uuid),
    isPending: query.isPending,
    isFetching: query.isFetching,
    isError: pages.hasError,
    more: {
      hasMore: query.hasNextPage,
      failed: pages.moreFailed,
      loading: query.isFetchingNextPage,
      disabled: query.isFetching,
      onLoad: () => void pages.loadMore(),
    },
    refetch: query.refetch,
  };
}
