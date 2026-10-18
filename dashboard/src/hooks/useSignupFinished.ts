import { useUserProfile } from '@hooks/useUserProfile';
import { useAuth } from '@ledova/shared';

export function useSignupFinished() {
  const { isAuthenticated } = useAuth();
  const { userProfile } = useUserProfile();
  return isAuthenticated && userProfile?.isSignupCompleted === true;
}
