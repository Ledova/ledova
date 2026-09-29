import { useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import {
  CACHE_TIMING,
  PUBLICATION_COPY,
  apiErrorSentence,
  assertNextPageAdvances,
  castBallot,
  downloadPublication,
  getPublications,
  getPublicationsNextPage,
  publicationFilename,
} from '@ledova/shared';
import type { BallotChoice, UserFriendlyError } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { shareDocumentCopy, UTI_BY_MIME_TYPE } from '../../services/documentCopies';
import { getSessionEpoch } from '../../services/sessionScope';

const SHARING_UNAVAILABLE = 'Sharing is not available on this device.';

const PUBLICATIONS_KEY = ['publications'];

function whyItCouldNotBeOpened(error: unknown): string {
  const cause = (error as UserFriendlyError | undefined)?.originalError ?? error;
  const status = (cause as { response?: { status?: number } })?.response?.status;
  return status === 503 ? PUBLICATION_COPY.UNDELIVERABLE : PUBLICATION_COPY.FAILED;
}

export function usePublications() {
  const queryClient = useQueryClient();
  const [openingUuid, setOpeningUuid] = useState<string | undefined>(undefined);
  const [openError, setOpenError] = useState<string | undefined>(undefined);
  const [castingUuid, setCastingUuid] = useState<string | undefined>(undefined);
  const [castError, setCastError] = useState<{ uuid: string; message: string } | undefined>(undefined);

  const listing = useInfiniteQuery({
    queryKey: [...PUBLICATIONS_KEY, 'addressed', 'me'],
    queryFn: async ({ pageParam }) => {
      const response = await getPublications(apiClient, pageParam, { addressed: 'me' });
      assertNextPageAdvances(pageParam, response.data);
      return response;
    },
    getNextPageParam: getPublicationsNextPage,
    initialPageParam: 1,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  const open = async (uuid: string) => {
    if (openingUuid) return;
    const sessionEpoch = getSessionEpoch();
    setOpeningUuid(uuid);
    setOpenError(undefined);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setOpenError(SHARING_UNAVAILABLE);
        return;
      }
      await shareDocumentCopy(
        sessionEpoch,
        async () => {
          const response = await downloadPublication(apiClient, uuid, { ledovaSessionEpoch: sessionEpoch });
          const type = String(response.headers['content-type'] || 'application/octet-stream').split(';')[0];
          return { name: publicationFilename(uuid, type), type, bytes: new Uint8Array(response.data) };
        },
        (uri, type) => Sharing.shareAsync(uri, { mimeType: type, UTI: UTI_BY_MIME_TYPE[type] }),
      );
    } catch (error) {
      if (sessionEpoch === getSessionEpoch()) setOpenError(whyItCouldNotBeOpened(error));
    } finally {
      setOpeningUuid(undefined);
    }
  };

  const cast = async (uuid: string, choice: BallotChoice) => {
    if (castingUuid) return;
    const sessionEpoch = getSessionEpoch();
    setCastingUuid(uuid);
    setCastError(undefined);
    try {
      await castBallot(apiClient, uuid, choice, { ledovaSessionEpoch: sessionEpoch });
    } catch (error) {
      if (sessionEpoch === getSessionEpoch())
        setCastError({ uuid, message: apiErrorSentence(error, PUBLICATION_COPY.BALLOT_FAILED) });
    } finally {
      if (sessionEpoch === getSessionEpoch()) await queryClient.invalidateQueries({ queryKey: PUBLICATIONS_KEY });
      setCastingUuid(undefined);
    }
  };

  return {
    publications: listing.data?.pages.flatMap((page) => page.data?.results ?? []) ?? [],
    isLoading: listing.isLoading,
    listFailed: listing.isError && !listing.isFetchNextPageError,
    moreFailed: listing.isFetchNextPageError,
    isRefreshing: listing.isFetching,
    retry: () => void listing.refetch(),
    hasMore: listing.hasNextPage,
    isLoadingMore: listing.isFetchingNextPage,
    loadMore: () => void listing.fetchNextPage(),
    open,
    openingUuid,
    openError,
    cast,
    castingUuid,
    castError,
  };
}
