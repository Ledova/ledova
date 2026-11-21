import { useInfiniteQuery } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import { READ_TIMING } from '../constants/api';
import { getRegisterEntries } from '../services/register-entries';
import { assertNextPageAdvances, firstOfEach, getNextPageParam } from '../utils/pagination';
import { useApiClient } from './useApiClient';
import { useLaterPages } from './useLaterPages';
import { entriesKey } from './useShareholder';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

async function guarded<Result>(guard: () => void, read: () => Promise<Result>) {
  guard();
  const result = await read();
  guard();
  return result;
}

function readEntries(
  apiClient: AxiosInstance,
  token: string,
  page: number,
  guard: () => void,
  session?: OrderSubmissionSession,
) {
  return guarded(guard, () =>
    getRegisterEntries(apiClient, token, { page }, { ...session?.requestConfig(), ledovaSubmissionGuard: guard }),
  );
}

export function useRegisterEntries(
  owner: OrderSubmissionOwner,
  token: string,
  guard: () => void,
  enabled = true,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  const queryKey = entriesKey(owner, token);
  const query = useInfiniteQuery({
    queryKey,
    enabled,
    queryFn: async ({ pageParam }) => {
      const { data } = await readEntries(apiClient, token, pageParam, guard, session);
      assertNextPageAdvances(pageParam, data);
      return data;
    },
    getNextPageParam,
    initialPageParam: 1,
    ...READ_TIMING,
  });
  const pages = useLaterPages(queryKey, query);
  return {
    entries: firstOfEach(query.data?.pages.flatMap((page) => page.results) ?? [], ({ uuid }) => uuid),
    isPending: query.isPending,
    hasError: pages.hasError,
    moreFailed: pages.moreFailed,
    hasMore: query.hasNextPage,
    isFetching: query.isFetching,
    isLoadingMore: query.isFetchingNextPage,
    retry: () => void query.refetch(),
    refresh: () => query.refetch({ cancelRefetch: false }),
    loadMore: () => void pages.loadMore(),
  };
}
