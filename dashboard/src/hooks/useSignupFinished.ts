import { useUserProfile } from '@pages/user-profile/useUserProfile';
import { useAuth } from './useAuth';

export function useSignupFinished() {
  const { isAuthenticated } = useAuth();
  const { userProfile } = useUserProfile();
  return isAuthenticated && userProfile?.isSignupCompleted === true;
}
