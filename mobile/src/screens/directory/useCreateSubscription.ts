import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSubscription, SUBSCRIPTIONS_QUERY_KEY, type SubscriptionInput } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch } from '../../services/sessionScope';

const SUBSCRIPTIONS_KEY = SUBSCRIPTIONS_QUERY_KEY;

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
