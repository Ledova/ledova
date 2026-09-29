import { useQueryClient, type QueryKey } from '@tanstack/react-query';

interface PagedRead {
  isError: boolean;
  isFetching: boolean;
  isFetchNextPageError: boolean;
  hasNextPage: boolean;
  error: unknown;
  fetchNextPage: () => Promise<{ isFetchNextPageError: boolean; error: unknown }>;
}

const laterPageFailures = new WeakMap<object, unknown>();

export function useLaterPages(queryKey: QueryKey, query: PagedRead) {
  const cached = useQueryClient().getQueryCache().find({ queryKey, exact: true });
  const moreFailed =
    query.isFetchNextPageError ||
    (query.isError && cached !== undefined && laterPageFailures.get(cached) === query.error);

  return {
    hasError: query.isError && !moreFailed,
    moreFailed,
    loadMore: async () => {
      if (!query.hasNextPage || query.isFetching) return;
      const result = await query.fetchNextPage();
      if (result.isFetchNextPageError && cached) laterPageFailures.set(cached, result.error);
    },
  };
}
