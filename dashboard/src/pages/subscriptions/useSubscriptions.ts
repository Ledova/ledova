import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  const query = useInfiniteQuery({
    queryKey: [...SUBSCRIPTIONS_KEY, 'list'],
    queryFn: async ({ pageParam }) => {
      const { data } = await getSubscriptions(apiClient, pageParam);
      const next = getNextPageParam(data);
      if (data.next && (next === undefined || !Number.isInteger(next) || next <= pageParam)) {
        throw new Error('Application pagination did not advance');
      }
      return data;
    },
    getNextPageParam,
    initialPageParam: 1,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  return {
    subscriptions: query.data?.pages.flatMap((page) => page.results) ?? [],
    isLoading: query.isLoading,
    hasError: query.isError && !query.isFetchNextPageError,
    moreFailed: query.isFetchNextPageError,
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    isRefreshing: query.isFetching,
    retry: () => query.refetch(),
    loadMore: () => query.fetchNextPage(),
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
