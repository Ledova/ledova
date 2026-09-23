import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  PUBLICATION_COPY,
  getPublications,
  getPublicationsNextPage,
  openPublication,
  publicationFilename,
} from '@ledova/shared';
import apiClient from '@services/apiClient';

const PUBLICATIONS_KEY = ['publications'];

function saveACopy(document_: Blob, filename: string) {
  const url = URL.createObjectURL(document_);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function whyItCouldNotBeOpened(error: unknown): string {
  const status = (error as { response?: { status?: number } })?.response?.status;
  return status === 503 ? PUBLICATION_COPY.UNDELIVERABLE : PUBLICATION_COPY.FAILED;
}

export function usePublications() {
  const listing = useInfiniteQuery({
    queryKey: PUBLICATIONS_KEY,
    queryFn: ({ pageParam }) => getPublications(apiClient, pageParam),
    getNextPageParam: getPublicationsNextPage,
    initialPageParam: 1,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  const opening = useMutation({
    mutationFn: async (uuid: string) => {
      const response = await openPublication(apiClient, uuid);
      saveACopy(response.data, publicationFilename(uuid, response.data.type));
    },
  });

  return {
    publications: listing.data?.pages.flatMap((page) => page.data?.results ?? []) ?? [],
    isLoading: listing.isLoading,
    listFailed: listing.isError && !listing.data,
    retry: () => void listing.refetch(),
    hasMore: listing.hasNextPage,
    isLoadingMore: listing.isFetchingNextPage,
    loadMore: () => void listing.fetchNextPage(),
    open: opening.mutate,
    openingUuid: opening.isPending ? opening.variables : undefined,
    openError: opening.isError ? whyItCouldNotBeOpened(opening.error) : undefined,
  };
}
