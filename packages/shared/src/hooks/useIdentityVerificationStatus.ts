import { useQuery } from '@tanstack/react-query';

import { CACHE_TIMING } from '../constants/api';
import { getIdentityVerificationStatus } from '../services/identityVerification';
import { useApiClient } from './useApiClient';

export function useIdentityVerificationStatus(justSubmitted: boolean) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: ['identity-verification', 'status'],
    queryFn: async () => {
      const response = await getIdentityVerificationStatus(apiClient);
      return response.data;
    },
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
    gcTime: CACHE_TIMING.LONG_GC_TIME,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,

    refetchInterval: (query) => {
      if (!justSubmitted) return false;
      const data = query.state.data;
      if (data?.isVerified) return false;
      if (data?.reviewAnswer === 'RED' && !data?.needsRetry) return false;
      return 5000;
    },
  });
}
