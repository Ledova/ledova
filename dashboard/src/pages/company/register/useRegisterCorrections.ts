import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  assertNextPageAdvances,
  getNextPageParam,
  getRegisterCorrections,
  getRegisterEntries,
  getRegisterReconciliations,
  readEveryPage,
  useLaterPages,
  type OrderSubmissionOwner,
  type RegisterCorrection,
  type RegisterEntry,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { READ_TIMING, registerKey } from './useCompanyRegister';

export type ClassCorrection = { proposal: RegisterCorrection; entry: RegisterEntry };

export function entriesKey(owner: OrderSubmissionOwner, token: string) {
  return [...registerKey(owner), 'entries', token];
}

export function correctionsKey(owner: OrderSubmissionOwner, token: string) {
  return [...registerKey(owner), 'corrections', token];
}

export function reconciliationKey(owner: OrderSubmissionOwner, token: string) {
  return [...registerKey(owner), 'reconciliation', token];
}

async function guarded<Result>(guard: () => void, read: () => Promise<Result>) {
  guard();
  const result = await read();
  guard();
  return result;
}

function firstOfEach<Row>(rows: Row[], uuidOf: (row: Row) => string) {
  const kept = new Map<string, Row>();
  for (const row of rows) if (!kept.has(uuidOf(row))) kept.set(uuidOf(row), row);
  return [...kept.values()];
}

function readEntries(token: string, page: number, guard: () => void) {
  return guarded(guard, () => getRegisterEntries(apiClient, token, { page }, { ledovaSubmissionGuard: guard }));
}

async function readNamedEntries(token: string, entry: string[], guard: () => void) {
  if (!entry.length) return new Map<string, RegisterEntry>();
  const named = await readEveryPage((page) =>
    guarded(guard, () => getRegisterEntries(apiClient, token, { entry, page }, { ledovaSubmissionGuard: guard })),
  );
  if (named.some(({ uuid }) => !entry.includes(uuid)))
    throw new Error('The register answered with entries it was not asked for.');
  return new Map(named.map((row) => [row.uuid, row]));
}

async function readCorrectionPage(token: string, page: number, guard: () => void) {
  const { data } = await guarded(guard, () =>
    getRegisterCorrections(apiClient, { token, page }, { ledovaSubmissionGuard: guard }),
  );
  const corrected = await readNamedEntries(token, [...new Set(data.results.map(({ corrects }) => corrects))], guard);
  return {
    data: {
      ...data,
      results: data.results.map((proposal): ClassCorrection => {
        const entry = corrected.get(proposal.corrects);
        if (!entry) throw new Error('The corrections named an entry outside this share class.');
        return { proposal, entry };
      }),
    },
  };
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

export function useClassCorrections(owner: OrderSubmissionOwner, token: string, guard: () => void) {
  return useQuery({
    queryKey: correctionsKey(owner, token),
    queryFn: async () =>
      firstOfEach(
        await readEveryPage((page) => readCorrectionPage(token, page, guard)),
        ({ proposal }) => proposal.uuid,
      ).sort((left, right) => Date.parse(right.proposal.createdAt) - Date.parse(left.proposal.createdAt)),
    ...READ_TIMING,
  });
}

export function useLatestReconciliation(owner: OrderSubmissionOwner, token: string, guard: () => void) {
  return useQuery({
    queryKey: reconciliationKey(owner, token),
    queryFn: async () => {
      const { data } = await guarded(guard, () =>
        getRegisterReconciliations(apiClient, { token, page: 1 }, { ledovaSubmissionGuard: guard }),
      );
      const latest = data.results[0] ?? null;
      if (latest && latest.token !== token) throw new Error('The reconciliation did not identify this share class.');
      return latest;
    },
    ...READ_TIMING,
  });
}

export async function readClassEntry(token: string, uuid: string, guard: () => void) {
  const entry = (await readNamedEntries(token, [uuid], guard)).get(uuid);
  if (entry && !entry.changes.every(({ shares }) => /^-?\d+$/.test(shares)))
    throw new Error('The register entry did not state exact share changes.');
  return entry ?? null;
}
