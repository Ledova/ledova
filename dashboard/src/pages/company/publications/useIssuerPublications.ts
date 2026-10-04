import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  createUserFriendlyError,
  PUBLICATION_COPY,
  getPublications,
  openPublication,
  publicationFilename,
  readEveryPage,
  type UserFriendlyError,
  type Publication,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import type { CompanyActionRead } from '../CompanyState';

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

export function useIssuerPublications(companyUuid: string | undefined, read: CompanyActionRead) {
  const client = useQueryClient();
  const mounted = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const key = ['publications', 'issuer', companyUuid, read.scopeKey];
  const guard = () => {
    if (!mounted.current) throw createUserFriendlyError('This company document action is closed.');
    read.assertCurrent(companyUuid!, 'owner');
  };
  const listing = useQuery({
    queryKey: key,
    enabled: !!companyUuid,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
    queryFn: () =>
      readEveryPage(async (page) => {
        guard();
        const result = await getPublications(apiClient, page, { issuer: companyUuid! });
        guard();
        return result;
      }),
  });
  const opening = useMutation({
    mutationFn: async (uuid: string) => {
      const current = () => {
        guard();
        const state = client.getQueryState<Publication[]>(key);
        if (
          state?.status !== 'success' ||
          state.fetchStatus !== 'idle' ||
          !state.data?.some((item) => item.uuid === uuid)
        )
          throw createUserFriendlyError('Refresh company publications before continuing.');
      };
      try {
        current();
        const { data } = await openPublication(apiClient, uuid);
        current();
        saveACopy(data, publicationFilename(uuid, data.type));
      } finally {
        pending.current = false;
      }
    },
  });
  return {
    listing,
    open: (uuid: string) => {
      if (!pending.current) {
        pending.current = true;
        opening.mutate(uuid);
      }
    },
    openingUuid: opening.isPending ? opening.variables : undefined,
    openError: opening.isError ? openingFailure(opening.error) : undefined,
  };
}
