import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { canOpen, landingFor, type Audience } from '@ledova/shared';

import { useAuth } from '@hooks/useAuth';
import { useRole } from '@hooks/useRole';
import { useUserProfile } from '@pages/user-profile/useUserProfile';

const SIGNUP_RESUMES_AT = '/signup/account-type';

function RoleUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 min-h-screen bg-surface-raised px-4 text-center"
    >
      <p className="text-sm text-text-primary">Your account could not be checked, so this page cannot open yet.</p>
      <button
        type="button"
        onClick={onRetry}
        className="font-semibold text-brand-light transition-colors hover:text-brand-subtle"
      >
        Try again
      </button>
    </div>
  );
}

export function ProtectedRoute({ audience, children }: { audience: Audience; children: ReactNode }) {
  const { isAuthenticated, isLoading, isFetching } = useAuth();
  const { role, isKnown, isUnavailable, retry } = useRole();
  const { userProfile, isLoading: isProfileLoading } = useUserProfile();
  const needsRole = isAuthenticated && audience !== 'everyone';
  const waitingForAccount = isAuthenticated && (isProfileLoading || (needsRole && !isKnown && !isUnavailable));

  if (isLoading || (!isAuthenticated && isFetching) || waitingForAccount) {
    return (
      <div
        role="status"
        aria-label="Checking your session"
        className="flex items-center justify-center min-h-screen bg-surface-raised"
      >
        <div className="h-8 w-8 border-4 border-brand-subtle border-t-brand rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/signin" replace />;

  if (!userProfile?.isSignupCompleted) return <Navigate to={SIGNUP_RESUMES_AT} replace />;

  if (needsRole && !isKnown) return <RoleUnavailable onRetry={() => void retry()} />;

  if (!canOpen(role, audience)) return <Navigate to={landingFor(role)} replace />;

  return <>{children}</>;
}
