import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  createSubscription,
  getSubscription,
  submitSubscription,
  withdrawSubscription,
} from '@ledova/shared';
import type { SubscriptionInput } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch } from '../../services/sessionScope';

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
    mutationFn: async ({ uuid: selectedUuid, epoch }: { uuid: string; epoch: number }) => {
      assertSessionEpoch(epoch);
      const response = await submitSubscription(apiClient, selectedUuid, { ledovaSessionEpoch: epoch });
      assertSessionEpoch(epoch);
      return response;
    },
    onSuccess: refresh,
  });

  const withdraw = useMutation({
    mutationFn: async ({ uuid: selectedUuid, reason, epoch }: { uuid: string; reason: string; epoch: number }) => {
      assertSessionEpoch(epoch);
      const response = await withdrawSubscription(apiClient, selectedUuid, reason, { ledovaSessionEpoch: epoch });
      assertSessionEpoch(epoch);
      return response;
    },
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
    submit: {
      ...submit,
      error: submit.variables?.uuid === uuid ? submit.error : null,
      isPending: submit.variables?.uuid === uuid && submit.isPending,
      mutate: (epoch: number) => submit.mutate({ uuid: uuid!, epoch }),
      mutateAsync: (epoch: number) => submit.mutateAsync({ uuid: uuid!, epoch }),
    },
    withdraw: {
      ...withdraw,
      error: withdraw.variables?.uuid === uuid ? withdraw.error : null,
      isPending: withdraw.variables?.uuid === uuid && withdraw.isPending,
      mutate: (input: { reason: string; epoch: number }) => withdraw.mutate({ ...input, uuid: uuid! }),
      mutateAsync: (input: { reason: string; epoch: number }) => withdraw.mutateAsync({ ...input, uuid: uuid! }),
    },
  };
}

export function useCreateSubscription(onCreated: (uuid: string) => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ input, epoch }: { input: SubscriptionInput; epoch: number }) => {
      assertSessionEpoch(epoch);
      const response = await createSubscription(apiClient, input, { ledovaSessionEpoch: epoch });
      assertSessionEpoch(epoch);
      return response;
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
      onCreated(response.data.uuid);
    },
  });
}
