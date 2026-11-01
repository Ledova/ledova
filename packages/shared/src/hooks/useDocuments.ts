import { useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosRequestConfig } from 'axios';
import {
  attachDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  uploadDocument,
  type UploadDocumentInput,
} from '../services/documents';
import type { Document } from '../types';
import { readEveryPage } from '../utils/pagination';
import { useApiClient } from './useApiClient';
import { INVESTOR_CLASSIFICATIONS_QUERY_KEY } from './useInvestorClassifications';
import type { OrderSubmissionSession } from './useSubmissionOwner';

const DOCUMENTS_KEY = ['documents'] as const;
const documentKey = (uuid: string) => ['document', uuid] as const;
const unsubscribed = () => () => undefined;

export function useDocuments(session?: OrderSubmissionSession) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: DOCUMENTS_KEY,
    queryFn: () => readEveryPage((page) => listDocuments(apiClient, page, session?.requestConfig())),
  });
}

export function useDocument(
  uuid: string | null,
  { session, paused = false }: { session?: OrderSubmissionSession; paused?: boolean } = {},
) {
  const apiClient = useApiClient();
  const [opened] = useState(() => ({ epoch: session?.getEpoch(), config: session?.requestConfig() }));
  const current = useSyncExternalStore(session?.subscribe ?? unsubscribed, () => session?.getEpoch() === opened.epoch);
  return useQuery({
    queryKey: documentKey(uuid ?? ''),
    queryFn: () => getDocument(apiClient, uuid!, opened.config).then((r) => r.data),
    enabled: !!uuid && current && !paused,
    refetchInterval: (query) => {
      const doc = query.state.data as Document | undefined;
      const status = doc?.latestExtraction?.status;

      if (status === 'pending' || status === 'running') return 3000;
      if (!status && doc && Date.now() - Date.parse(doc.createdAt) < 60_000) return 3000;
      return false;
    },
  });
}

export function useUploadDocument() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ config, ...input }: UploadDocumentInput & { config?: AxiosRequestConfig }) =>
      uploadDocument(apiClient, input, config).then((r) => r.data),
    onSuccess: (doc) => {
      queryClient.setQueryData(documentKey(doc.uuid), doc);
      queryClient.invalidateQueries({ queryKey: DOCUMENTS_KEY });
    },
  });
}

export function useDeleteDocument(session?: OrderSubmissionSession) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (uuid: string) => deleteDocument(apiClient, uuid, session?.requestConfig()),
    onSuccess: (_data, uuid) => {
      queryClient.removeQueries({ queryKey: documentKey(uuid) });
      queryClient.invalidateQueries({ queryKey: DOCUMENTS_KEY });
    },
  });
}

export function useAttachDocument(session?: OrderSubmissionSession) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ uuid, classification }: { uuid: string; classification: string }) =>
      attachDocument(apiClient, uuid, classification, session?.requestConfig()).then((r) => r.data),
    onSuccess: (doc) => {
      queryClient.setQueryData(documentKey(doc.uuid), doc);
      queryClient.invalidateQueries({ queryKey: DOCUMENTS_KEY });
      queryClient.invalidateQueries({ queryKey: INVESTOR_CLASSIFICATIONS_QUERY_KEY });
    },
  });
}
