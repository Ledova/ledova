import { useQuery } from '@tanstack/react-query';

import { CACHE_TIMING } from '../constants/api';
import { verifyAuth } from '../services/auth';
import { useApiClient } from './useApiClient';

export const AUTH_QUERY_ROOT = ['auth'] as const;
export const AUTH_QUERY_KEY = [...AUTH_QUERY_ROOT, 'verify'] as const;

const signedOut = (error: unknown) => (error as { response?: { status?: number } } | null)?.response?.status === 401;

export function useAuth() {
  const apiClient = useApiClient();
  const query = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: () => verifyAuth(apiClient),
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    gcTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
    retry: (failures, error) => failures < 1 && !signedOut(error),
    retryDelay: 500,
  });
  const failedSignedOut = query.isError && signedOut(query.error);
  const isAuthenticated = (query.data?.data?.valid ?? false) && !failedSignedOut;

  return {
    isAuthenticated,
    isUnavailable: query.isError && !failedSignedOut && !isAuthenticated,
    isLoading: query.isLoading && !query.isFetched,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}
