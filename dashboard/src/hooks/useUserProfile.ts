import { useUserProfile as useSharedUserProfile } from '@ledova/shared';

export function useUserProfile() {
  const { userProfile, profile, update, updateProfile, acceptTerms, sourceKey, ownerKey } = useSharedUserProfile();
  return {
    userProfile,
    isLoading: profile.isLoading,
    isError: profile.isError,
    isFetching: profile.isFetching,
    refreshProfile: () => profile.refetch(),
    updateProfile,
    acceptTerms,
    isUpdating: update.isPending,
    updateError: update.error,
    resetUpdate: update.reset,
    sourceKey,
    ownerKey,
  };
}
