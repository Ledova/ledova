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

export function useClassCorrections(owner: OrderSubmissionOwner, company: string, token: string, guard: () => void) {
  return useQuery({
    queryKey: correctionsKey(owner, token),
    queryFn: async (): Promise<ClassCorrection[]> => {
      const proposals = await readEveryPage((page) =>
        guarded(guard, () => getRegisterCorrections(apiClient, { company, page }, { ledovaSubmissionGuard: guard })),
      );
      if (proposals.some((proposal) => proposal.company !== company))
        throw new Error('The corrections did not identify this company.');
      const entries = proposals.length ? await readEveryPage((page) => readEntries(token, page, guard)) : [];
      const corrected = new Map(entries.map((entry) => [entry.uuid, entry]));
      return proposals
        .flatMap((proposal) => {
          const entry = corrected.get(proposal.corrects);
          return entry ? [{ proposal, entry }] : [];
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
  let page: number | undefined = 1;
  while (page !== undefined) {
    const { data } = await readEntries(token, page, guard);
    const entry = data.results.find((row) => row.uuid === uuid);
    if (entry) {
      if (!entry.changes.every(({ shares }) => /^-?\d+$/.test(shares)))
        throw new Error('The register entry did not state exact share changes.');
      return entry;
    }
    assertNextPageAdvances(page, data);
    page = getNextPageParam(data);
  }
  return null;
}
