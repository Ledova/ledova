import { useLayoutEffect, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  READ_TIMING,
  getClassDetailsHistory,
  createUserFriendlyError,
  assertNextPageAdvances,
  getNextPageParam,
  useApiClient,
  type useShareClass,
  type OrderSubmissionOwner,
  type OrderSubmissionSession,
} from '@ledova/shared';

export function classDetailsHistoryKey(owner: OrderSubmissionOwner | null, token: string) {
  return ['class-details-history', owner?.userUuid, owner?.ownerAccountUuid, token];
}

export function useClassDetailsHistory(
  data: ReturnType<typeof useShareClass>,
  owner: OrderSubmissionOwner,
  enabled = false,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  const token = data.token.data;
  const available =
    enabled &&
    !!token &&
    data.token.isSuccess &&
    !data.token.isError &&
    data.owner?.userUuid === owner.userUuid &&
    data.owner?.ownerAccountUuid === owner.ownerAccountUuid;
  const current = useRef({ available, guard: data.guard, owner: data.owner, token });
  useLayoutEffect(() => {
    current.current = { available, guard: data.guard, owner: data.owner, token };
  }, [available, data.guard, data.owner, token]);
  const guard = () => {
    current.current.guard();
    if (
      !current.current.available ||
      current.current.owner !== data.owner ||
      current.current.token?.uuid !== token?.uuid ||
      current.current.token?.companyUuid !== token?.companyUuid ||
      current.current.token?.updatedAt !== token?.updatedAt
    )
      throw createUserFriendlyError('The current share class could not be confirmed. Reopen its history.');
  };
  const query = useInfiniteQuery({
    queryKey: [...classDetailsHistoryKey(owner, token?.uuid ?? ''), token?.updatedAt],
    enabled: available,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      guard();
      const { data: history } = await getClassDetailsHistory(
        apiClient,
        token!.uuid,
        { page: pageParam },
        { ...session?.requestConfig(), ledovaSubmissionGuard: guard },
      );
      guard();
      assertNextPageAdvances(pageParam, history);
      if (history.results.some((revision) => revision.token !== token?.uuid))
        throw new Error('The class details history did not identify this share class.');
      return history;
    },
    getNextPageParam,
    ...READ_TIMING,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const first = query.data?.pages[0];
  const coherent = query.data?.pages.every((page) => page.count === first?.count) ?? true;
  const ready = available && query.isSuccess && query.fetchStatus === 'idle' && coherent;
  return {
    query,
    ready,
    hasError: available && (query.isError || !coherent),
    revisions: ready ? (query.data?.pages.flatMap((page) => page.results) ?? []) : [],
    count: ready ? (first?.count ?? 0) : 0,
  };
}
