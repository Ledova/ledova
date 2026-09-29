import { useQuery } from '@tanstack/react-query';

import { CACHE_TIMING } from '../constants/api';
import { getFeatureFlags } from '../services/featureFlags';
import { readFeatureFlags, type FeatureFlagInputs } from '../utils/feature-flags';
import { useApiClient } from './useApiClient';

export function useFeatureFlags(
  inputs: FeatureFlagInputs = {},
  refetch: { refetchOnWindowFocus?: boolean; refetchOnReconnect?: boolean } = {},
) {
  const apiClient = useApiClient();
  const query = useQuery({
    queryKey: ['featureFlags'],
    queryFn: () => getFeatureFlags(apiClient),
    staleTime: CACHE_TIMING.LONG_STALE_TIME,
    gcTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
    ...refetch,
  });

  const { flags, isEnabled } = readFeatureFlags(query.data?.data?.results || [], inputs);

  return {
    flags,
    isEnabled,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
