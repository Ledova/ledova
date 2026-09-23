import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import { CACHE_TIMING, PUBLICATION_COPY, downloadPublication, getPublications } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { shareDocumentCopy } from '../../services/documentCopies';
import { getSessionEpoch } from '../../services/sessionScope';

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

const UTI_BY_MIME_TYPE: Record<string, string> = {
  'application/pdf': 'com.adobe.pdf',
  'image/png': 'public.png',
  'image/jpeg': 'public.jpeg',
};

const SHARING_UNAVAILABLE = 'Sharing is not available on this device.';

function whyItCouldNotBeOpened(error: unknown): string {
  const status = (error as { response?: { status?: number } })?.response?.status;
  return status === 503 ? PUBLICATION_COPY.UNDELIVERABLE : PUBLICATION_COPY.FAILED;
}

export function usePublications() {
  const [openingUuid, setOpeningUuid] = useState<string | undefined>(undefined);
  const [openError, setOpenError] = useState<string | undefined>(undefined);

  const listing = useQuery({
    queryKey: ['publications'],
    queryFn: () => getPublications(apiClient),
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
          return { name: `${uuid}${EXTENSION_BY_MIME_TYPE[type] || ''}`, type, bytes: new Uint8Array(response.data) };
        },
        (uri, type) => Sharing.shareAsync(uri, { mimeType: type, UTI: UTI_BY_MIME_TYPE[type] }),
      );
    } catch (error) {
      if (sessionEpoch === getSessionEpoch()) setOpenError(whyItCouldNotBeOpened(error));
    } finally {
      setOpeningUuid(undefined);
    }
  };

  return {
    publications: listing.data?.data?.results ?? [],
    isLoading: listing.isLoading,
    open,
    openingUuid,
    openError,
  };
}
