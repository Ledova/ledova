import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSubscription, type SubscriptionInput, SUBSCRIPTIONS_QUERY_KEY } from '@ledova/shared';
import apiClient from '@services/apiClient';

const SUBSCRIPTIONS_KEY = SUBSCRIPTIONS_QUERY_KEY;

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
