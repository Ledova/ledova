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

function readEntries(token: string, page: number, guard: () => void) {
  return guarded(guard, () => getRegisterEntries(apiClient, token, { page }, { ledovaSubmissionGuard: guard }));
}

async function readEntriesUntil(token: string, wanted: Set<string>, guard: () => void) {
  const found = new Map<string, RegisterEntry>();
  let page: number | undefined = 1;
  while (page !== undefined && found.size < wanted.size) {
    const { data } = await readEntries(token, page, guard);
    data.results.filter((entry) => wanted.has(entry.uuid)).forEach((entry) => found.set(entry.uuid, entry));
    assertNextPageAdvances(page, data);
    page = getNextPageParam(data);
  }
  return found;
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
    entries: query.data?.pages.flatMap((page) => page.results) ?? [],
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
    queryFn: async (): Promise<ClassCorrection[]> => {
      const proposals = await readEveryPage((page) =>
        guarded(guard, () => getRegisterCorrections(apiClient, { token, page }, { ledovaSubmissionGuard: guard })),
      );
      const corrected = await readEntriesUntil(token, new Set(proposals.map(({ corrects }) => corrects)), guard);
      return proposals
        .map((proposal) => {
          const entry = corrected.get(proposal.corrects);
          if (!entry) throw new Error('The corrections named an entry outside this share class.');
          return { proposal, entry };
        })
        .sort((left, right) => Date.parse(right.proposal.createdAt) - Date.parse(left.proposal.createdAt));
    },
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
  const entry = (await readEntriesUntil(token, new Set([uuid]), guard)).get(uuid);
  if (entry && !entry.changes.every(({ shares }) => /^-?\d+$/.test(shares)))
    throw new Error('The register entry did not state exact share changes.');
  return entry ?? null;
}
