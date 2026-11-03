import { useContext, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { canOpen, landingFor, useAuth, type Audience } from '@ledova/shared';

import { useRole } from '@hooks/useRole';
import { useUserProfile } from '@hooks/useUserProfile';
import { InSignedInFrame } from '@components/InSignedInFrame';
import { Page } from '@components/Page';
import { FullScreenSpinner } from '@components/FullScreenSpinner';
import { AccountUnavailable, SessionUnavailable } from './AccountUnavailable';
import { SIGNUP_RESUMES_AT, SIGNIN_PATH } from '@utils/paths';

export function ProtectedRoute({ audience, children }: { audience: Audience; children: ReactNode }) {
  const { isAuthenticated, isUnavailable: sessionUnavailable, isLoading, isFetching, refetch } = useAuth();
  const { role } = useRole();
  const { userProfile, isLoading: isProfileLoading, refreshProfile } = useUserProfile();
  const waitingForAccount = isAuthenticated && isProfileLoading;
  const inFrame = useContext(InSignedInFrame);

  if (isLoading || (!isAuthenticated && isFetching) || waitingForAccount) {
    return inFrame ? <Page loading /> : <FullScreenSpinner label="Checking your session" />;
  }

  if (sessionUnavailable) return <SessionUnavailable onRetry={() => void refetch()} />;

  if (!isAuthenticated) return <Navigate to={SIGNIN_PATH} replace />;

  if (!userProfile) return <AccountUnavailable onRetry={refreshProfile} />;

  if (!userProfile.isSignupCompleted) return <Navigate to={SIGNUP_RESUMES_AT} replace />;

  if (!canOpen(role, audience)) return <Navigate to={landingFor(role)} replace />;

  if (!inFrame) return <FullScreenSpinner label="Checking your session" />;

  return <>{children}</>;
}
