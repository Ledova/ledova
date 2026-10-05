import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  deleteInvestorClassification,
  getInvestorClassifications,
  getInvestorReadiness,
  readEveryPage,
  submitInvestorClassification,
} from '@ledova/shared';
import type { InvestorClassificationSubmission } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch } from '../../services/sessionScope';

type Submission = Omit<InvestorClassificationSubmission, 'file'> & { file: unknown; sessionEpoch: number };

export function useInvestorEligibility() {
  const queryClient = useQueryClient();
  const eligibilityQuery = useQuery({
    queryKey: ['investor-eligibility'],
    queryFn: () => getInvestorReadiness(apiClient),
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });
  const classificationsQuery = useQuery({
    queryKey: ['investor-classifications', 'verification'],
    queryFn: () => readEveryPage((page) => getInvestorClassifications(apiClient, page)),
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['investor-eligibility'] }),
      queryClient.invalidateQueries({ queryKey: ['investor-classifications'] }),
      queryClient.invalidateQueries({ queryKey: ['directory'] }),
    ]);
  const submitMutation = useMutation({
    mutationFn: ({ sessionEpoch, ...data }: Submission) =>
      submitInvestorClassification(apiClient, data as InvestorClassificationSubmission, {
        ledovaSessionEpoch: sessionEpoch,
      }),
    onSuccess: (_response, variables) => {
      if (variables.sessionEpoch === getSessionEpoch()) return refresh();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: ({ uuid }: { uuid: string; sessionEpoch: number }) => deleteInvestorClassification(apiClient, uuid),
    onSuccess: (_response, variables) => {
      if (variables.sessionEpoch === getSessionEpoch()) return refresh();
    },
  });
  return {
    eligibility: eligibilityQuery.data?.data,
    classifications: classificationsQuery.data ?? [],
    isLoading: eligibilityQuery.isLoading || classificationsQuery.isLoading,
    hasError: eligibilityQuery.isError || classificationsQuery.isError,
    isRefreshing: eligibilityQuery.isFetching || classificationsQuery.isFetching,
    refresh,
    submitClaim: submitMutation.mutateAsync,
    isSubmitting: submitMutation.isPending,
    deleteClaim: (uuid: string) => deleteMutation.mutateAsync({ uuid, sessionEpoch: getSessionEpoch() }),
    isDeleting: deleteMutation.isPending,
  };
}
