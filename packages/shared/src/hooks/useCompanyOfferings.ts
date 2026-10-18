import { useQuery } from '@tanstack/react-query';
import { CACHE_TIMING } from '../constants';
import { getOfferings } from '../services/offerings';
import { readEveryPage } from '../utils/pagination';
import { useApiClient } from './useApiClient';

export const OFFERINGS_QUERY_KEY = ['offerings'] as const;

export function companyOfferingsKey(companyUuid: string | undefined, scopeKey: string) {
  return [...OFFERINGS_QUERY_KEY, companyUuid, scopeKey];
}

export function useCompanyOfferings(
  companyUuid: string | undefined,
  scopeKey: string,
  enabled: boolean,
  readPage: <T>(load: () => Promise<T>) => Promise<T>,
) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: companyOfferingsKey(companyUuid, scopeKey),
    queryFn: () => readEveryPage((page) => readPage(() => getOfferings(apiClient, page))),
    enabled,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });
}
