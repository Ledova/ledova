import { useQuery } from '@tanstack/react-query';
import { CACHE_TIMING } from '../constants';
import { getInvestorClassifications } from '../services/investorClassifications';
import { readEveryPage } from '../utils/pagination';
import { useApiClient } from './useApiClient';

export const INVESTOR_CLASSIFICATIONS_QUERY_KEY = ['investor-classifications'] as const;
export const INVESTOR_ELIGIBILITY_QUERY_KEY = ['investor-eligibility'] as const;

export function investorClassificationsKey() {
  return [...INVESTOR_CLASSIFICATIONS_QUERY_KEY, 'verification'];
}

export function useInvestorClassifications() {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: investorClassificationsKey(),
    queryFn: () => readEveryPage((page) => getInvestorClassifications(apiClient, page)),
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });
}
