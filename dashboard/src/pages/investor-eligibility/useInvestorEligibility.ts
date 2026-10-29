import { useQueryClient } from '@tanstack/react-query';
import { useInvestorClassifications, INVESTOR_CLASSIFICATIONS_QUERY_KEY } from '@ledova/shared';

export function useInvestorEligibility() {
  const queryClient = useQueryClient();
  const classificationsQuery = useInvestorClassifications();

  return {
    classifications: classificationsQuery.data ?? [],
    isLoading: classificationsQuery.isLoading,
    hasError: classificationsQuery.isError,
    isRefreshing: classificationsQuery.isFetching,
    retry: () => classificationsQuery.refetch(),
    refresh: () => queryClient.invalidateQueries({ queryKey: INVESTOR_CLASSIFICATIONS_QUERY_KEY }),
  };
}
