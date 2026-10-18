import type { QueryClient } from '@tanstack/react-query';
import { AUTH_QUERY_KEY } from '@ledova/shared';

export function resetSessionQueries(queryClient: QueryClient) {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== AUTH_QUERY_KEY[0] });
  return queryClient.refetchQueries({ queryKey: AUTH_QUERY_KEY, exact: true });
}

export function clearSessionQueries(queryClient: QueryClient) {
  queryClient.setQueryData(AUTH_QUERY_KEY, { data: { valid: false } });
  queryClient.clear();
}
