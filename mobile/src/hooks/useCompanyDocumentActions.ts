import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AxiosRequestConfig } from 'axios';
import { deleteCompanyDocument, uploadCompanyDocument, type DocumentType } from '@ledova/shared';
import { apiClient } from '../services/apiClient';
import { assertSessionEpoch } from '../services/sessionScope';
import type { useCompanyProfile } from './useCompanyProfile';

export type CompanyDocumentUpload = {
  documentType: DocumentType;
  name: string;
  file: unknown;
  companyUuid: string;
  sessionEpoch: number;
  assertCurrent: () => void;
};

type Bound = {
  guard: () => void;
  config: AxiosRequestConfig;
  companyKey: readonly unknown[];
  companiesKey: readonly unknown[];
};

export function useCompanyDocumentActions(read: ReturnType<typeof useCompanyProfile>) {
  const client = useQueryClient();
  const bind = (uuid: string, childGuard: () => void): Bound => {
    const guard = () => {
      childGuard();
      read.assertCurrent(uuid);
    };
    return {
      guard,
      config: { ...read.requestConfig(uuid), ledovaSubmissionGuard: guard },
      companyKey: read.companyKey,
      companiesKey: read.companiesKey,
    };
  };
  const refresh = async (_response: unknown, variables: Bound) => {
    variables.guard();
    await Promise.all([
      client.invalidateQueries({ queryKey: variables.companyKey }),
      client.invalidateQueries({ queryKey: variables.companiesKey }),
    ]);
    variables.guard();
  };
  const uploadMutation = useMutation({
    mutationFn: async (input: CompanyDocumentUpload & Bound) => {
      assertSessionEpoch(input.sessionEpoch);
      input.guard();
      const response = await uploadCompanyDocument(
        apiClient,
        input.companyUuid,
        { documentType: input.documentType, name: input.name, file: input.file } as Parameters<
          typeof uploadCompanyDocument
        >[2],
        { ...input.config, ledovaSessionEpoch: input.sessionEpoch },
      );
      assertSessionEpoch(input.sessionEpoch);
      input.guard();
      if (
        !response.data.uuid ||
        response.data.company !== input.companyUuid ||
        response.data.name !== input.name ||
        response.data.documentType !== input.documentType
      )
        throw new Error('The document upload could not be confirmed. Refresh before retrying.');
      return response;
    },
    onSuccess: refresh,
  });
  const deletion = useMutation({
    mutationFn: async (input: { companyUuid: string; documentUuid: string } & Bound) => {
      input.guard();
      const company = client.getQueryData<NonNullable<typeof read.company>>(input.companyKey);
      if (
        !company?.documents.some(
          (document) => document.uuid === input.documentUuid && document.company === input.companyUuid,
        )
      )
        throw new Error('This document is no longer available for this company.');
      const response = await deleteCompanyDocument(apiClient, input.companyUuid, input.documentUuid, input.config);
      input.guard();
      if (response.status !== 204)
        throw new Error('The document removal could not be confirmed. Refresh before retrying.');
      return response;
    },
    onSuccess: refresh,
  });
  return {
    upload: (input: CompanyDocumentUpload) =>
      uploadMutation.mutateAsync({ ...input, ...bind(input.companyUuid, input.assertCurrent) }),
    isUploading: uploadMutation.isPending,
    deletion: {
      ...deletion,
      mutateAsync: (input: { companyUuid: string; documentUuid: string; assertCurrent: () => void }) =>
        deletion.mutateAsync({ ...input, ...bind(input.companyUuid, input.assertCurrent) }),
    },
  };
}
