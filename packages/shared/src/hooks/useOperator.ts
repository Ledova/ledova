import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { CACHE_TIMING } from '../constants';
import { getOperator } from '../services/operator';
import { useApiClient } from './useApiClient';

export const OPERATOR_QUERY_KEY = ['operator'] as const;

type OperatorResponse = Awaited<ReturnType<typeof getOperator>>;
type OperatorPolicy = { enabled?: boolean; cache?: 'response' | 'body' };

export function useOperator(policy: OperatorPolicy & { cache: 'body' }): UseQueryResult<OperatorResponse['data']>;
export function useOperator(policy?: OperatorPolicy & { cache?: 'response' }): UseQueryResult<OperatorResponse>;
export function useOperator(policy: OperatorPolicy = {}) {
  const apiClient = useApiClient();
  return useQuery<OperatorResponse | OperatorResponse['data']>({
    queryKey: OPERATOR_QUERY_KEY,
    queryFn:
      policy.cache === 'body' ? () => getOperator(apiClient).then((res) => res.data) : () => getOperator(apiClient),
    ...(policy.enabled === undefined ? {} : { enabled: policy.enabled }),
    staleTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
  });
}
