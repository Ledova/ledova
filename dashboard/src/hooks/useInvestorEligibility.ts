import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  useInvestorClassifications,
  INVESTOR_CLASSIFICATIONS_QUERY_KEY,
  getInvestorReadiness,
  INVESTOR_ELIGIBILITY_QUERY_KEY,
  DIRECTORY_QUERY_KEY,
} from '@ledova/shared';
import apiClient from '@services/apiClient';

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
