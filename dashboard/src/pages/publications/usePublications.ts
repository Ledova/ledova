import { useMutation, useQuery } from '@tanstack/react-query';
import { CACHE_TIMING, PUBLICATION_COPY, getPublications, openPublication } from '@ledova/shared';
import apiClient from '@services/apiClient';

const PUBLICATIONS_KEY = ['publications'];

function showInANewTab(document_: Blob) {
  const url = URL.createObjectURL(document_);
  window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function whyItCouldNotBeOpened(error: unknown): string {
  const status = (error as { response?: { status?: number } })?.response?.status;
  return status === 503 ? PUBLICATION_COPY.UNDELIVERABLE : PUBLICATION_COPY.FAILED;
}

export function usePublications() {
  const listing = useQuery({
    queryKey: PUBLICATIONS_KEY,
    queryFn: () => getPublications(apiClient),
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  const opening = useMutation({
    mutationFn: async (uuid: string) => {
      const response = await openPublication(apiClient, uuid);
      showInANewTab(response.data);
    },
  });

  return {
    publications: listing.data?.data?.results ?? [],
    isLoading: listing.isLoading,
    open: opening.mutate,
    openingUuid: opening.isPending ? opening.variables : undefined,
    openError: opening.isError ? whyItCouldNotBeOpened(opening.error) : undefined,
  };
}
