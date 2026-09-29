import { useQueryClient, type QueryKey, type UseInfiniteQueryResult } from '@tanstack/react-query';

const laterPageFailures = new WeakMap<object, number>();

export function useLaterPages<TData>(queryKey: QueryKey, query: UseInfiniteQueryResult<TData>) {
  const cached = useQueryClient().getQueryCache().find({ queryKey, exact: true });
  const moreFailed =
    query.isFetchNextPageError ||
    (query.isError && cached !== undefined && laterPageFailures.get(cached) === query.errorUpdateCount);

  return {
    hasError: query.isError && !moreFailed,
    moreFailed,
    loadMore: async () => {
      if (!query.hasNextPage || query.isFetching) return;
      const result = await query.fetchNextPage();
      if (result.isFetchNextPageError && cached) laterPageFailures.set(cached, result.errorUpdateCount);
    },
  };
}
