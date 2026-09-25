import { Navigate, Outlet } from 'react-router-dom';
import { landingFor } from '@ledova/shared';

import { useAuth } from '@hooks/useAuth';
import { useRole } from '@hooks/useRole';
import { useUserProfile } from '@pages/user-profile/useUserProfile';

export function SignupRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const { userProfile, isLoading: isProfileLoading } = useUserProfile();
  const { role, isLoading: isRoleLoading } = useRole();
  const finished = isAuthenticated && userProfile?.isSignupCompleted === true;

  if (isLoading || isProfileLoading || (finished && isRoleLoading)) return null;

  if (finished) return <Navigate to={landingFor(role)} replace />;

  return <Outlet />;
}
