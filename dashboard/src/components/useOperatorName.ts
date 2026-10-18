import { useQuery } from '@tanstack/react-query';
import { getOperator, CACHE_TIMING, useAuth, OPERATOR_QUERY_KEY } from '@ledova/shared';
import apiClient from '@services/apiClient';

export function useOperatorName(): string | null {
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: OPERATOR_QUERY_KEY,
    queryFn: () => getOperator(apiClient),
    enabled: isAuthenticated,
    staleTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
  });
  return query.data?.data?.name || null;
}
