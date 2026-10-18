import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  failureStatus,
  useSubscriptionDetail,
  submitSubscription,
  withdrawSubscription,
  SUBSCRIPTIONS_QUERY_KEY,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch } from '../../services/sessionScope';

const SUBSCRIPTIONS_KEY = SUBSCRIPTIONS_QUERY_KEY;

export function useSubscription(uuid: string | undefined) {
  const queryClient = useQueryClient();

  const query = useSubscriptionDetail(uuid);

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

  const notFound = failureStatus(query.error) === 404;

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
