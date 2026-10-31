import { QueryClient } from '@tanstack/react-query';
import { AUTH_QUERY_KEY, USER_PREFERENCES_QUERY_KEY } from '@ledova/shared';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, refetchOnReconnect: false, refetchInterval: false },
  },
});
for (const queryKey of [AUTH_QUERY_KEY, USER_PREFERENCES_QUERY_KEY]) {
  queryClient.setQueryDefaults(queryKey, { refetchOnWindowFocus: true, refetchOnReconnect: true });
}
