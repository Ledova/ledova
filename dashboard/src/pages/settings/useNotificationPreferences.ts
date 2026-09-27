import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getNotificationPreferences, updateNotificationPreferences, CACHE_TIMING } from '@ledova/shared';
import type { UpdateNotificationPreferencesRequest, NotificationPreferences } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { useAuth } from '@hooks/useAuth';

export function useNotificationPreferences() {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const preferencesQuery = useQuery({
    queryKey: ['notificationPreferences'],
    queryFn: () => getNotificationPreferences(apiClient),
    enabled: isAuthenticated,
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    gcTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
  });

  const updateMutation = useMutation({
    mutationFn: (data: UpdateNotificationPreferencesRequest) => updateNotificationPreferences(apiClient, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationPreferences'] });
    },
  });

  const preferences: NotificationPreferences | undefined = preferencesQuery.data?.data;

  return {
    transactionAlerts: preferences?.transactionAlerts,
    isLoading: preferencesQuery.isLoading,
    isError: preferencesQuery.isError,
    retry: preferencesQuery.refetch,
    isUpdating: updateMutation.isPending,
    updateError: updateMutation.isError,
    toggleTransactionAlerts: (value: boolean) => updateMutation.mutate({ transactionAlerts: value }),
  };
}
