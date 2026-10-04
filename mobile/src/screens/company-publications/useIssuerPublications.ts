import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import {
  CACHE_TIMING,
  PUBLICATION_COPY,
  downloadPublication,
  getPublications,
  publicationFilename,
  readEveryPage,
  type UserFriendlyError,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { shareDocumentCopy, UTI_BY_MIME_TYPE } from '../../services/documentCopies';
import type { CompanyActionRead } from '../company/CompanyState';
import { assertSessionEpoch, getSessionEpoch, subscribeSession } from '../../services/sessionScope';

function openingFailure(error: unknown) {
  const cause = (error as UserFriendlyError | undefined)?.originalError ?? error;
  return (cause as { response?: { status?: number } })?.response?.status === 503
    ? PUBLICATION_COPY.UNDELIVERABLE
    : PUBLICATION_COPY.FAILED;
}

export function useIssuerPublications(read: CompanyActionRead) {
  const companyUuid = read.companyUuid;
  const enabled = read.access.allowed && read.ownerBusiness && !read.error;
  const ready = !read.isRefreshing;
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch);
  const scope = `${read.scopeKey}:${epoch}:${companyUuid ?? ''}`;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const listing = useQuery({
    queryKey: ['publications', 'issuer', companyUuid, epoch, read.scopeKey],
    enabled: enabled && !!companyUuid,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
    queryFn: () =>
      readEveryPage(async (page) => {
        assertSessionEpoch(epoch);
        read.assertCurrent(companyUuid!, 'owner');
        const response = await getPublications(apiClient, page, { issuer: companyUuid! });
        assertSessionEpoch(epoch);
        read.assertCurrent(companyUuid!, 'owner');
        return response;
      }),
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
    const isCurrent = () => {
      if (
        !mounted.current ||
        epoch !== getSessionEpoch() ||
        current.current.scope !== scope ||
        !current.current.canOpen
      )
        return false;
      try {
        read.assertCurrent(companyUuid!, 'owner');
        return true;
      } catch {
        return false;
      }
    };
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
          const response = await downloadPublication(apiClient, uuid, {
            ...read.requestConfig(companyUuid!, 'owner'),
            ledovaSessionEpoch: epoch,
            ledovaSubmissionGuard: () => {
              if (!isCurrent()) throw new Error('The publication view changed.');
            },
          });
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
