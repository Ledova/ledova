import { useQuery } from '@tanstack/react-query';
import { CACHE_TIMING } from '../constants';
import { getOperator } from '../services/operator';
import { useApiClient } from './useApiClient';

const OPERATOR_QUERY_KEY = ['operator'] as const;

export function useOperator({ enabled }: { enabled?: boolean } = {}) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: OPERATOR_QUERY_KEY,
    queryFn: () => getOperator(apiClient),
    ...(enabled === undefined ? {} : { enabled }),
    staleTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
  });
}
