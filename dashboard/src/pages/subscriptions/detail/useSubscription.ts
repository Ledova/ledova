import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  failureStatus,
  useSubscriptionDetail,
  submitSubscription,
  withdrawSubscription,
  SUBSCRIPTIONS_QUERY_KEY,
} from '@ledova/shared';
import apiClient from '@services/apiClient';

const SUBSCRIPTIONS_KEY = SUBSCRIPTIONS_QUERY_KEY;

export function useSubscription(uuid: string | undefined) {
  const queryClient = useQueryClient();

  const query = useSubscriptionDetail(uuid);

  const refresh = () => queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });

  const submit = useMutation({
    mutationFn: () => submitSubscription(apiClient, uuid!),
    onSuccess: refresh,
  });

  const withdraw = useMutation({
    mutationFn: (reason: string) => withdrawSubscription(apiClient, uuid!, reason),
    onSuccess: refresh,
  });

  const notFound = failureStatus(query.error) === 404;

  return {
    subscription: query.data?.data ?? null,
    isLoading: query.isLoading,
    notFound,
    hasError: query.isError && !notFound,
    isRefreshing: query.isFetching,
    retry: () => query.refetch(),
    submit,
    withdraw,
  };
}
