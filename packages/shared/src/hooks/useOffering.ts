import { useQuery } from '@tanstack/react-query';

import { CACHE_TIMING } from '../constants/api';
import { getOffering, getOfferingSubscriptions } from '../services/offerings';
import { readEveryPage } from '../utils/pagination';
import { useApiClient } from './useApiClient';

export function useOfferingSubscriptions(uuid?: string) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: ['offering-subscriptions', uuid],
    queryFn: () => readEveryPage((page) => getOfferingSubscriptions(apiClient, uuid!, page)),
    enabled: !!uuid,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });
}

export function useOfferingUnderEdit(uuid?: string) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: ['offering', uuid],
    queryFn: async () => (await getOffering(apiClient, uuid!)).data,
    enabled: !!uuid,
    staleTime: 0,
  });
}
