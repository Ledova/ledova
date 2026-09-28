import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getUserProfiles, updateUserProfile, CACHE_TIMING, useAuth, type UpdateUserProfile } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
export function useUserProfile() {
  const { isAuthenticated } = useAuth();
  const client = useQueryClient();
  const profile = useQuery({
    queryKey: ['userProfiles'],
    queryFn: () => getUserProfiles(apiClient),
    enabled: isAuthenticated,
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    gcTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
  });
  const userProfile = profile.data?.data.results[0] ?? null;
  const update = useMutation({
    mutationFn: ({ uuid, data }: { uuid: string; data: UpdateUserProfile }) => updateUserProfile(apiClient, uuid, data),
    onSuccess: () => client.invalidateQueries({ queryKey: ['userProfiles'] }),
  });
  const updateProfile = (data: UpdateUserProfile, onSuccess: () => void) => {
    if (!userProfile?.uuid || profile.isFetching || profile.isError || update.isPending) return;
    update.mutate({ uuid: userProfile.uuid, data }, { onSuccess });
  };
  return { userProfile, profile, update, updateProfile };
}
