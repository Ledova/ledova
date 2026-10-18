import { useUserProfile as useSharedUserProfile } from '@ledova/shared';

export function useUserProfile() {
  const { userProfile, profile, update, updateProfile, sourceKey, ownerKey } = useSharedUserProfile();
  return {
    userProfile,
    isLoading: profile.isLoading,
    isError: profile.isError,
    isFetching: profile.isFetching,
    refreshProfile: () => profile.refetch(),
    updateProfile,
    isUpdating: update.isPending,
    updateError: update.isError,
    resetUpdate: update.reset,
    sourceKey,
    ownerKey,
  };
}
