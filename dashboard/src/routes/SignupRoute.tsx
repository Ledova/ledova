import { invitationDestination } from '@utils/memberInvitation';
import { COMPANY_DASHBOARD_PATH } from '@utils/paths';
import { Navigate, Outlet } from 'react-router-dom';
import { canOpen, landingFor, useAuth } from '@ledova/shared';

import { useRole } from '@hooks/useRole';
import { useSignupFinished } from '@hooks/useSignupFinished';
import { useUserProfile } from '@hooks/useUserProfile';
import { AccountUnavailable } from './AccountUnavailable';

export function SignupRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const { userProfile, isLoading: isProfileLoading, refreshProfile } = useUserProfile();
  const { role, isLoading: isRoleLoading } = useRole();
  const finished = useSignupFinished();

  if (isLoading || isProfileLoading || (finished && isRoleLoading)) return null;

  if (finished)
    return (
      <Navigate
        to={invitationDestination(canOpen(role, 'company') ? COMPANY_DASHBOARD_PATH : landingFor(role))}
        replace
      />
    );

  if (isAuthenticated && !userProfile) return <AccountUnavailable onRetry={refreshProfile} />;

  return <Outlet />;
}
