import { Navigate, Outlet } from 'react-router-dom';
import { landingFor, useAuth } from '@ledova/shared';

import { useRole } from '@hooks/useRole';
import { useSignupFinished } from '@hooks/useSignupFinished';
import { useUserProfile } from '@pages/user-profile/useUserProfile';
import { AccountUnavailable } from './AccountUnavailable';

export function SignupRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const { userProfile, isLoading: isProfileLoading, refreshProfile } = useUserProfile();
  const { role, isLoading: isRoleLoading } = useRole();
  const finished = useSignupFinished();

  if (isLoading || isProfileLoading || (finished && isRoleLoading)) return null;

  if (finished) return <Navigate to={landingFor(role)} replace />;

  if (isAuthenticated && !userProfile) return <AccountUnavailable onRetry={refreshProfile} />;

  return <Outlet />;
}
