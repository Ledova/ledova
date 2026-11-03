import { useInfiniteQuery } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import { READ_TIMING } from '../constants/api';
import { getRegisterEntries } from '../services/register-corrections';
import type { RegisterEntry } from '../types';
import { assertNextPageAdvances, firstOfEach, getNextPageParam, readEveryPage } from '../utils/pagination';
import { useApiClient } from './useApiClient';
import { useLaterPages } from './useLaterPages';
import { entriesKey } from './useShareholder';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

export async function guarded<Result>(guard: () => void, read: () => Promise<Result>) {
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

export async function readNamedEntries(
  apiClient: AxiosInstance,
  token: string,
  entry: string[],
  guard: () => void,
  session?: OrderSubmissionSession,
) {
  if (!entry.length) return new Map<string, RegisterEntry>();
  const named = await readEveryPage((page) =>
    guarded(guard, () =>
      getRegisterEntries(
        apiClient,
        token,
        { entry, page },
        { ...session?.requestConfig(), ledovaSubmissionGuard: guard },
      ),
    ),
  );
  if (named.some(({ uuid }) => !entry.includes(uuid)))
    throw new Error('The register answered with entries it was not asked for.');
  return new Map(named.map((row) => [row.uuid, row]));
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
    loadMore: () => void pages.loadMore(),
  };
}

export async function readClassEntry(
  apiClient: AxiosInstance,
  token: string,
  uuid: string,
  guard: () => void,
  session?: OrderSubmissionSession,
) {
  const entry = (await readNamedEntries(apiClient, token, [uuid], guard, session)).get(uuid);
  if (entry && !entry.changes.every(({ shares }) => /^-?\d+$/.test(shares)))
    throw new Error('The register entry did not state exact share changes.');
  return entry ?? null;
}
