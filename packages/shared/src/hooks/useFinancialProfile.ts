import { useQuery } from '@tanstack/react-query';
import { CACHE_TIMING } from '../constants/api';
import { getFinancialProfiles } from '../services/financialProfile';
import { useApiClient } from './useApiClient';

export const FINANCIAL_PROFILES_QUERY_KEY = ['financialProfiles'] as const;

export function useFinancialProfile() {
  const apiClient = useApiClient();
  const query = useQuery({
    queryKey: FINANCIAL_PROFILES_QUERY_KEY,
    queryFn: () => getFinancialProfiles(apiClient),
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    gcTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
  });

  return {
    financialProfile: query.data?.data?.results?.[0] || null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
