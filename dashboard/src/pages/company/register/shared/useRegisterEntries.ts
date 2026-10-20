import { useInfiniteQuery } from '@tanstack/react-query';
import {
  assertNextPageAdvances,
  getNextPageParam,
  getRegisterEntries,
  readEveryPage,
  useLaterPages,
  type OrderSubmissionOwner,
  type RegisterEntry,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { READ_TIMING, registerKey } from '@hooks/useRegisterAccess';
import { firstOfEach, guarded } from './registerReads';

export function registerEntriesKey(owner: OrderSubmissionOwner) {
  return [...registerKey(owner), 'entries'];
}

export function entriesKey(owner: OrderSubmissionOwner, token: string) {
  return [...registerEntriesKey(owner), token];
}

function readEntries(token: string, page: number, guard: () => void) {
  return guarded(guard, () => getRegisterEntries(apiClient, token, { page }, { ledovaSubmissionGuard: guard }));
}

export async function readNamedEntries(token: string, entry: string[], guard: () => void) {
  if (!entry.length) return new Map<string, RegisterEntry>();
  const named = await readEveryPage((page) =>
    guarded(guard, () => getRegisterEntries(apiClient, token, { entry, page }, { ledovaSubmissionGuard: guard })),
  );
  if (named.some(({ uuid }) => !entry.includes(uuid)))
    throw new Error('The register answered with entries it was not asked for.');
  return new Map(named.map((row) => [row.uuid, row]));
}

export async function readMemberEntries(tokens: string[], member: string, guard: () => void) {
  const classes = await Promise.all(
    tokens.map(async (token) => {
      const rows = await readEveryPage((page) =>
        guarded(guard, () => getRegisterEntries(apiClient, token, { member, page }, { ledovaSubmissionGuard: guard })),
      );
      if (rows.some((row) => !row.changes.some((change) => change.member === member)))
        throw new Error('The register answered with entries for another member.');
      if (rows.some((row) => row.changes.some((change) => !/^-?\d+$/.test(String(change.shares)))))
        throw new Error('The register entries did not give whole share changes.');
      return firstOfEach(rows, ({ uuid }) => uuid).map((entry) => ({ token, entry }));
    }),
  );
  return classes
    .flat()
    .sort(
      (left, right) =>
        right.entry.effectiveOn.localeCompare(left.entry.effectiveOn) ||
        Date.parse(right.entry.recordedAt) - Date.parse(left.entry.recordedAt),
    );
}

export function useRegisterEntries(owner: OrderSubmissionOwner, token: string, guard: () => void) {
  const queryKey = entriesKey(owner, token);
  const query = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const { data } = await readEntries(token, pageParam, guard);
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

export async function readClassEntry(token: string, uuid: string, guard: () => void) {
  const entry = (await readNamedEntries(token, [uuid], guard)).get(uuid);
  if (entry && !entry.changes.every(({ shares }) => /^-?\d+$/.test(shares)))
    throw new Error('The register entry did not state exact share changes.');
  return entry ?? null;
}
