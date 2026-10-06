import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CACHE_TIMING, getInvestorClassifications, getInvestorReadiness, readEveryPage } from '@ledova/shared';
import apiClient from '@services/apiClient';

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

  return {
    eligibility: eligibilityQuery.data?.data,
    classifications: classificationsQuery.data ?? [],
    isLoading: eligibilityQuery.isLoading || classificationsQuery.isLoading,
    hasError: eligibilityQuery.isError || classificationsQuery.isError,
    isRefreshing: eligibilityQuery.isFetching || classificationsQuery.isFetching,
    retry: () => Promise.all([eligibilityQuery.refetch(), classificationsQuery.refetch()]),
    refresh,
  };
}
