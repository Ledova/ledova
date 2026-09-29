import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  createSubscription,
  getSubscription,
  submitSubscription,
  withdrawSubscription,
} from '@ledova/shared';
import type { SubscriptionInput } from '@ledova/shared';
import apiClient from '@services/apiClient';

const SUBSCRIPTIONS_KEY = ['subscriptions'];

export function useSubscription(uuid: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['subscriptions', uuid],
    queryFn: () => getSubscription(apiClient, uuid!),
    enabled: !!uuid,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });

  const submit = useMutation({
    mutationFn: () => submitSubscription(apiClient, uuid!),
    onSuccess: refresh,
  });

  const withdraw = useMutation({
    mutationFn: (reason: string) => withdrawSubscription(apiClient, uuid!, reason),
    onSuccess: refresh,
  });

  const notFound = (query.error as { response?: { status?: number } } | null)?.response?.status === 404;

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

export function useCreateSubscription(onCreated: (uuid: string) => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SubscriptionInput) => createSubscription(apiClient, input),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
      onCreated(response.data.uuid);
    },
  });
}
