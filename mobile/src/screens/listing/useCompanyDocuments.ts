import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AxiosRequestConfig } from 'axios';
import { submitApplication, resubmitApplication, withdrawApplication } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { useCompanyProfile } from '../../hooks/useCompanyProfile';
import { useCompanyDocumentActions } from '../../hooks/useCompanyDocumentActions';

export function useCompanyDocuments() {
  const queryClient = useQueryClient();
  const read = useCompanyProfile({ ownedOnly: true });
  const documentActions = useCompanyDocumentActions(read);
  const bind = (uuid: string, child: () => void) => {
    const guard = () => {
      child();
      read.assertCurrent(uuid, 'owner');
    };
    return {
      guard,
      config: { ...read.requestConfig(uuid, 'owner'), ledovaSubmissionGuard: guard },
      companyKey: read.companyKey,
      companiesKey: read.companiesKey,
    };
  };
  type Bound = {
    guard: () => void;
    config: AxiosRequestConfig;
    companyKey: readonly unknown[];
    companiesKey: readonly unknown[];
  };
  const refresh = async (_response: unknown, input: Bound) => {
    input.guard();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: input.companyKey }),
      queryClient.invalidateQueries({ queryKey: input.companiesKey }),
    ]);
    input.guard();
  };
  const submission = useMutation({
    mutationFn: async (input: { companyUuid: string } & Bound) => {
      input.guard();
      const result = await submitApplication(apiClient, input.companyUuid, input.config);
      input.guard();
      return result;
    },
    onSuccess: refresh,
  });
  const resubmission = useMutation({
    mutationFn: async (input: { companyUuid: string; response: string } & Bound) => {
      input.guard();
      const result = await resubmitApplication(
        apiClient,
        input.companyUuid,
        { response: input.response },
        input.config,
      );
      input.guard();
      return result;
    },
    onSuccess: refresh,
  });
  const withdrawal = useMutation({
    mutationFn: async (input: { companyUuid: string; reason: string } & Bound) => {
      input.guard();
      const result = await withdrawApplication(apiClient, input.companyUuid, { reason: input.reason }, input.config);
      input.guard();
      return result;
    },
    onSuccess: refresh,
  });
  return {
    ...read,
    documents: read.company?.documents ?? [],
    canEdit: read.canAdmin && (read.company?.status === 'draft' || read.company?.status === 'info_required'),
    ...documentActions,
    submission: {
      ...submission,
      mutateAsync: (input: { companyUuid: string; assertCurrent: () => void }) =>
        submission.mutateAsync({ ...input, ...bind(input.companyUuid, input.assertCurrent) }),
    },
    resubmission: {
      ...resubmission,
      mutateAsync: (input: { companyUuid: string; response: string; assertCurrent: () => void }) =>
        resubmission.mutateAsync({ ...input, ...bind(input.companyUuid, input.assertCurrent) }),
    },
    withdrawal: {
      ...withdrawal,
      mutateAsync: (input: { companyUuid: string; reason: string; assertCurrent: () => void }) =>
        withdrawal.mutateAsync({ ...input, ...bind(input.companyUuid, input.assertCurrent) }),
    },
  };
}
