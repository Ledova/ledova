import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  getInvestorClassifications,
  getInvestorEligibility,
  getNextPageParam,
  type InvestorClassification,
} from '@ledova/shared';
import apiClient from '@services/apiClient';

export function useInvestorEligibility() {
  const queryClient = useQueryClient();

  const eligibilityQuery = useQuery({
    queryKey: ['investor-eligibility'],
    queryFn: () => getInvestorEligibility(apiClient),
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  const classificationsQuery = useQuery({
    queryKey: ['investor-classifications', 'verification'],
    queryFn: async () => {
      const all: InvestorClassification[] = [];
      let page: number | undefined = 1;
      while (page !== undefined) {
        const { data } = await getInvestorClassifications(apiClient, page);
        all.push(...data.results);
        const next = getNextPageParam(data);
        if (data.next && (next === undefined || !Number.isInteger(next) || next <= page)) {
          throw new Error('Verification pagination did not advance');
        }
        page = next;
      }
      return all;
    },
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
