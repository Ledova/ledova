import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  createSubscription,
  getSubscription,
  getSubscriptions,
  getNextPageParam,
  getWallets,
  submitSubscription,
  withdrawSubscription,
} from '@ledova/shared';
import type { SubscriptionInput, Wallet } from '@ledova/shared';
import apiClient from '@services/apiClient';

const SUBSCRIPTIONS_KEY = ['subscriptions'];

export function useSubscriptions() {
  const query = useQuery({
    queryKey: SUBSCRIPTIONS_KEY,
    queryFn: () => getSubscriptions(apiClient),
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  return {
    subscriptions: query.data?.data?.results ?? [],
    isLoading: query.isLoading,
  };
}

export function useSubscription(uuid: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['subscriptions', uuid],
    queryFn: () => getSubscription(apiClient, uuid!),
    enabled: !!uuid,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
    queryClient.invalidateQueries({ queryKey: ['subscriptions', uuid] });
  };

  const submit = useMutation({
    mutationFn: () => submitSubscription(apiClient, uuid!),
    onSuccess: refresh,
  });

  const withdraw = useMutation({
    mutationFn: (reason: string) => withdrawSubscription(apiClient, uuid!, reason),
    onSuccess: refresh,
  });

  return {
    subscription: query.data?.data ?? null,
    isLoading: query.isLoading,
    notFound: query.isError,
    submit,
    withdraw,
  };
}

export function useSubscribableWallets(enabled: boolean) {
  const query = useQuery({
    queryKey: ['wallets', 'base-verified', 'complete'],
    queryFn: async () => {
      const all: Wallet[] = [];
      let page: number | undefined = 1;
      while (page !== undefined) {
        const { data } = await getWallets(apiClient, { chain: 'base', verification_status: 'VERIFIED', page });
        all.push(...data.results);
        const next = getNextPageParam(data);
        if (data.next && (next === undefined || !Number.isInteger(next) || next <= page)) {
          throw new Error('Receiving wallet pagination did not advance');
        }
        page = next;
      }
      return all;
    },
    enabled,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  return {
    wallets: query.data ?? [],
    isLoading: query.isLoading,
    hasError: query.isError,
    isRefreshing: query.isFetching,
    retry: () => query.refetch(),
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
