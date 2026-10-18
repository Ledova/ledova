import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  deleteInvestorClassification,
  useInvestorClassifications,
  INVESTOR_CLASSIFICATIONS_QUERY_KEY,
  getInvestorReadiness,
  submitInvestorClassification,
  INVESTOR_ELIGIBILITY_QUERY_KEY,
  DIRECTORY_QUERY_KEY,
} from '@ledova/shared';
import type { InvestorClassificationSubmission } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch } from '../../services/sessionScope';

type Submission = Omit<InvestorClassificationSubmission, 'file'> & { file: unknown; sessionEpoch: number };

export function useInvestorEligibility() {
  const queryClient = useQueryClient();
  const eligibilityQuery = useQuery({
    queryKey: INVESTOR_ELIGIBILITY_QUERY_KEY,
    queryFn: () => getInvestorReadiness(apiClient),
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });
  const classificationsQuery = useInvestorClassifications();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: INVESTOR_ELIGIBILITY_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: INVESTOR_CLASSIFICATIONS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: DIRECTORY_QUERY_KEY }),
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
