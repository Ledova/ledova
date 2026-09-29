import { useQueryClient, type QueryKey } from '@tanstack/react-query';

interface Failure {
  error: unknown;
  errorUpdateCount: number;
}

interface PagedRead extends Failure {
  isError: boolean;
  isFetching: boolean;
  isFetchNextPageError: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => Promise<Failure & { isFetchNextPageError: boolean }>;
}

const laterPageFailures = new WeakMap<object, Failure>();

export function useLaterPages(queryKey: QueryKey, query: PagedRead) {
  const cached = useQueryClient().getQueryCache().find({ queryKey, exact: true });
  const recorded = cached === undefined ? undefined : laterPageFailures.get(cached);
  const moreFailed =
    query.isFetchNextPageError ||
    (query.isError &&
      recorded !== undefined &&
      recorded.error === query.error &&
      recorded.errorUpdateCount === query.errorUpdateCount);

  return {
    hasError: query.isError && !moreFailed,
    moreFailed,
    loadMore: async () => {
      if (!query.hasNextPage || query.isFetching) return;
      const result = await query.fetchNextPage();
      if (result.isFetchNextPageError && cached)
        laterPageFailures.set(cached, { error: result.error, errorUpdateCount: result.errorUpdateCount });
    },
  };
}
