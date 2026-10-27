import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  failureStatus,
  createUserFriendlyError,
  PUBLICATION_COPY,
  assertNextPageAdvances,
  getNextPageParam,
  getPublications,
  openPublication,
  publicationFilename,
  useLaterPages,
  type PaginatedResponse,
  type UserFriendlyError,
  type Publication,
  PUBLICATIONS_QUERY_KEY,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { saveFile } from '@utils/saveFile';
import type { CompanyActionRead } from '@components/CompanyState';
import { useEntryReads } from '@hooks/useEntryReads';

function openingFailure(error: unknown) {
  const cause = (error as UserFriendlyError | undefined)?.originalError ?? error;
  return failureStatus(cause) === 503 ? PUBLICATION_COPY.UNDELIVERABLE : PUBLICATION_COPY.FAILED;
}

export function useIssuerPublications(
  companyUuid: string | undefined,
  read: CompanyActionRead,
  onOpeningChange: (opening: boolean) => void,
) {
  const client = useQueryClient();
  const mounted = useRef(true);
  const pending = useRef(false);
  const [openingBusy, setOpeningBusy] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      onOpeningChange(false);
    };
  }, []);
  const key = [...PUBLICATIONS_QUERY_KEY, 'issuer', companyUuid, read.scopeKey];
  const guard = () => {
    if (!mounted.current) throw createUserFriendlyError('This company document action is closed.');
    read.assertCurrent(companyUuid!, 'owner');
  };
  const listing = useInfiniteQuery({
    queryKey: key,
    enabled: !!companyUuid && !read.error && !read.isRefreshing && !openingBusy,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
    queryFn: async ({ pageParam }) => {
      guard();
      const { data } = await getPublications(apiClient, pageParam, { issuer: companyUuid! });
      guard();
      assertNextPageAdvances(pageParam, data);
      return data;
    },
    getNextPageParam,
    initialPageParam: 1,
  });
  const pages = useLaterPages(key, listing);
  const opening = useMutation({
    mutationFn: async (uuid: string) => {
      const current = () => {
        guard();
        const state = client.getQueryState<InfiniteData<PaginatedResponse<Publication>>>(key);
        if (
          state?.status !== 'success' ||
          state.fetchStatus !== 'idle' ||
          !state.data?.pages.some((page) => page.results.some((item) => item.uuid === uuid))
        )
          throw createUserFriendlyError('Company publications must be current before continuing. Try again.');
      };
      try {
        current();
        const { data } = await openPublication(apiClient, uuid);
        current();
        saveFile(data, publicationFilename(uuid, data.type));
      } finally {
        pending.current = false;
        if (mounted.current) setOpeningBusy(false);
        onOpeningChange(false);
      }
    },
  });
  useEntryReads({
    scope: read.scopeKey,
    paused: opening.isPending || listing.isFetchingNextPage,
    refresh: async (available) => {
      if (pending.current) return;
      if (read.isRefreshing || listing.isFetching) return false;
      await read.refetch();
      if (!available() || pending.current || !companyUuid) return;
      guard();
      await listing.refetch({ cancelRefetch: false });
      guard();
    },
  });
  return {
    listing,
    publications: listing.data
      ? [...new Map(listing.data.pages.flatMap((page) => page.results).map((item) => [item.uuid, item])).values()]
      : undefined,
    count: listing.data?.pages[0].count,
    hasError: pages.hasError,
    moreFailed: pages.moreFailed,
    loadMore: () => void pages.loadMore(),
    open: (uuid: string) => {
      if (!pending.current) {
        pending.current = true;
        setOpeningBusy(true);
        onOpeningChange(true);
        opening.mutate(uuid);
      }
    },
    openingUuid: opening.isPending ? opening.variables : undefined,
    openError: opening.isError ? openingFailure(opening.error) : undefined,
  };
}
