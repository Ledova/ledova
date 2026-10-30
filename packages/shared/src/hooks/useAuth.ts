import { useQuery } from '@tanstack/react-query';

import { CACHE_TIMING } from '../constants/api';
import { verifyAuth } from '../services/auth';
import { failureStatus } from '../utils/errors';
import { useApiClient } from './useApiClient';

export const AUTH_QUERY_ROOT = ['auth'] as const;
export const AUTH_QUERY_KEY = [...AUTH_QUERY_ROOT, 'verify'] as const;

export function useAuth() {
  const apiClient = useApiClient();
  const query = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: () => verifyAuth(apiClient),
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    gcTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
    retry: (failures, error) => failures < 1 && failureStatus(error) !== 401,
    retryDelay: 500,
  });

  return {
    isAuthenticated: query.isSuccess && (query.data?.data?.valid ?? false),
    isUnavailable: query.isError && failureStatus(query.error) !== 401,
    isLoading: query.isPending && !query.isFetched,
    isFetching: query.fetchStatus !== 'idle',
    refetch: query.refetch,
  };
}
