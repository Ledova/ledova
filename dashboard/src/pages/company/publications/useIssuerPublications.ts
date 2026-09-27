import { useMutation, useQuery } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  PUBLICATION_COPY,
  getPublications,
  getPublicationsNextPage,
  openPublication,
  publicationFilename,
  type Publication,
  type UserFriendlyError,
} from '@ledova/shared';
import apiClient from '@services/apiClient';

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

function openingFailure(error: unknown) {
  const cause = (error as UserFriendlyError | undefined)?.originalError ?? error;
  return (cause as { response?: { status?: number } })?.response?.status === 503
    ? PUBLICATION_COPY.UNDELIVERABLE
    : PUBLICATION_COPY.FAILED;
}

export function useIssuerPublications(companyUuid?: string) {
  const listing = useQuery({
    queryKey: ['publications', 'issuer', companyUuid],
    enabled: !!companyUuid,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
    queryFn: async () => {
      const rows: Publication[] = [];
      let page: number | undefined = 1;
      while (page !== undefined) {
        const response = await getPublications(apiClient, page, { issuer: companyUuid! });
        rows.push(...response.data.results);
        const next = getPublicationsNextPage(response);
        if (response.data.next && (next === undefined || !Number.isInteger(next) || next <= page)) {
          throw new Error('Issuer publication pagination did not advance');
        }
        page = next;
      }
      return rows;
    },
  });
  const opening = useMutation({
    mutationFn: async (uuid: string) => {
      const { data } = await openPublication(apiClient, uuid);
      saveACopy(data, publicationFilename(uuid, data.type));
    },
  });
  return {
    listing,
    open: opening.mutate,
    openingUuid: opening.isPending ? opening.variables : undefined,
    openError: opening.isError ? openingFailure(opening.error) : undefined,
  };
}
