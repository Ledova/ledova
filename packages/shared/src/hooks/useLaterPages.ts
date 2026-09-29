import { useQueryClient, type QueryKey } from '@tanstack/react-query';

interface PagedRead {
  isError: boolean;
  isFetching: boolean;
  isFetchNextPageError: boolean;
  hasNextPage: boolean;
  errorUpdateCount: number;
  fetchNextPage: () => Promise<{ isFetchNextPageError: boolean; errorUpdateCount: number }>;
}

const laterPageFailures = new WeakMap<object, number>();

export function useLaterPages(queryKey: QueryKey, query: PagedRead) {
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
