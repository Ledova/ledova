import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  uploadCompanyDocument,
  deleteCompanyDocument,
  submitApplication,
  resubmitApplication,
  withdrawApplication,
  type DocumentType,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch } from '../../services/sessionScope';
import { useCompanyProfile } from '../../hooks/useCompanyProfile';

export function useCompanyDocuments() {
  const queryClient = useQueryClient();
  const read = useCompanyProfile();
  const refresh = (owner: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['company', owner] }),
      queryClient.invalidateQueries({ queryKey: ['companies'] }),
      queryClient.invalidateQueries({ queryKey: ['company-documents', owner] }),
    ]);
  const uploadMutation = useMutation({
    mutationFn: ({
      documentType,
      name,
      file,
      companyUuid,
      sessionEpoch,
    }: {
      documentType: DocumentType;
      name: string;
      file: unknown;
      companyUuid: string;
      sessionEpoch: number;
    }) =>
      uploadCompanyDocument(
        apiClient,
        companyUuid,
        { documentType, name, file } as Parameters<typeof uploadCompanyDocument>[2],
        { ledovaSessionEpoch: sessionEpoch },
      ),
    onSuccess: (_response, variables) => {
      if (variables.sessionEpoch === getSessionEpoch()) return refresh(variables.companyUuid);
    },
  });
  const deletion = useMutation({
    mutationFn: ({ companyUuid, documentUuid }: { companyUuid: string; documentUuid: string }) =>
      deleteCompanyDocument(apiClient, companyUuid, documentUuid),
    onSuccess: (_response, variables) => refresh(variables.companyUuid),
  });
  const submission = useMutation({
    mutationFn: (companyUuid: string) => submitApplication(apiClient, companyUuid),
    onSuccess: (_response, owner) => refresh(owner),
  });
  const resubmission = useMutation({
    mutationFn: ({ companyUuid, response }: { companyUuid: string; response: string }) =>
      resubmitApplication(apiClient, companyUuid, { response }),
    onSuccess: (_response, variables) => refresh(variables.companyUuid),
  });
  const withdrawal = useMutation({
    mutationFn: ({ companyUuid, reason }: { companyUuid: string; reason: string }) =>
      withdrawApplication(apiClient, companyUuid, { reason }),
    onSuccess: (_response, variables) => refresh(variables.companyUuid),
  });
  return {
    ...read,
    documents: read.company?.documents ?? [],
    canEdit: read.company?.status === 'draft' || read.company?.status === 'info_required',
    upload: uploadMutation.mutateAsync,
    isUploading: uploadMutation.isPending,
    deletion,
    submission,
    resubmission,
    withdrawal,
  };
}
