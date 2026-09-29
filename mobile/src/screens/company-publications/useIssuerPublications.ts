import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import {
  CACHE_TIMING,
  PUBLICATION_COPY,
  downloadPublication,
  getPublications,
  getPublicationsNextPage,
  publicationFilename,
  type Publication,
  type UserFriendlyError,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { shareDocumentCopy, UTI_BY_MIME_TYPE } from '../../services/documentCopies';
import { assertSessionEpoch, getSessionEpoch, subscribeSession } from '../../services/sessionScope';

function openingFailure(error: unknown) {
  const cause = (error as UserFriendlyError | undefined)?.originalError ?? error;
  return (cause as { response?: { status?: number } })?.response?.status === 503
    ? PUBLICATION_COPY.UNDELIVERABLE
    : PUBLICATION_COPY.FAILED;
}

export function useIssuerPublications(companyUuid: string | undefined, enabled: boolean, ready: boolean) {
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch);
  const scope = `${epoch}:${companyUuid ?? ''}`;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const listing = useQuery({
    queryKey: ['publications', 'issuer', companyUuid, epoch],
    enabled: enabled && !!companyUuid,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
    queryFn: async () => {
      const rows: Publication[] = [];
      let page: number | undefined = 1;
      while (page !== undefined) {
        assertSessionEpoch(epoch);
        const response = await getPublications(apiClient, page, { issuer: companyUuid! });
        assertSessionEpoch(epoch);
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
  const canOpen = enabled && ready && listing.isSuccess && !listing.isFetching;
  const current = useRef({ scope, canOpen });
  useLayoutEffect(() => {
    current.current = { scope, canOpen };
  }, [scope, canOpen]);
  const pending = useRef<string | undefined>(undefined);
  const [opening, setOpening] = useState<{ scope: string; uuid: string }>();
  const [failure, setFailure] = useState<{ scope: string; message: string }>();

  const open = async (uuid: string) => {
    const isCurrent = () =>
      mounted.current && epoch === getSessionEpoch() && current.current.scope === scope && current.current.canOpen;
    if (!isCurrent() || pending.current === scope || !listing.data?.some((row) => row.uuid === uuid)) return;
    pending.current = scope;
    setOpening({ scope, uuid });
    setFailure(undefined);
    try {
      const available = await Sharing.isAvailableAsync();
      if (!isCurrent()) return;
      if (!available) {
        setFailure({ scope, message: 'Sharing is not available on this device.' });
        return;
      }
      await shareDocumentCopy(
        epoch,
        async () => {
          if (!isCurrent()) throw new Error('The publication view changed.');
          const response = await downloadPublication(apiClient, uuid, { ledovaSessionEpoch: epoch });
          if (!isCurrent()) throw new Error('The publication view changed.');
          const type = String(response.headers['content-type'] || 'application/octet-stream').split(';')[0];
          return { name: publicationFilename(uuid, type), type, bytes: new Uint8Array(response.data) };
        },
        async (uri, type) => {
          if (isCurrent()) await Sharing.shareAsync(uri, { mimeType: type, UTI: UTI_BY_MIME_TYPE[type] });
        },
      );
    } catch (error) {
      if (isCurrent()) setFailure({ scope, message: openingFailure(error) });
    } finally {
      if (pending.current === scope) pending.current = undefined;
      if (mounted.current) setOpening((value) => (value?.scope === scope ? undefined : value));
    }
  };

  return {
    listing,
    open,
    blocked: !canOpen,
    openingUuid: opening?.scope === scope ? opening.uuid : undefined,
    openError: failure?.scope === scope ? failure.message : undefined,
  };
}
