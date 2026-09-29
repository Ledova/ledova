import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getUserProfiles, updateUserProfile, CACHE_TIMING, useAuth } from '@ledova/shared';
import type { UpdateUserProfile } from '@ledova/shared';
import apiClient from '@services/apiClient';

export function useUserProfile() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();

  const userProfileQuery = useQuery({
    queryKey: ['userProfiles'],
    queryFn: () => getUserProfiles(apiClient),
    enabled: isAuthenticated,
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    gcTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
  });

  const userProfile = userProfileQuery.data?.data?.results?.[0] || null;

  const updateMutation = useMutation({
    mutationFn: ({ uuid, data }: { uuid: string; data: UpdateUserProfile }) => updateUserProfile(apiClient, uuid, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userProfiles'] });
    },
  });

  const handleUpdateProfile = (data: UpdateUserProfile, onSuccess: () => void) => {
    if (!userProfile?.uuid) return;
    updateMutation.mutate({ uuid: userProfile.uuid, data }, { onSuccess });
  };

  const refreshProfile = () => {
    userProfileQuery.refetch();
  };

  return {
    userProfile,
    isLoading: userProfileQuery.isLoading,
    isError: userProfileQuery.isError,
    refreshProfile,
    updateProfile: handleUpdateProfile,
    isUpdating: updateMutation.isPending,
    updateError: updateMutation.isError,
    resetUpdate: updateMutation.reset,
  };
}
