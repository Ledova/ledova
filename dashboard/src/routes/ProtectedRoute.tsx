import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { canOpen, landingFor, type Audience } from '@ledova/shared';

import { useAuth } from '@hooks/useAuth';
import { useRole } from '@hooks/useRole';

export function ProtectedRoute({ audience, children }: { audience: Audience; children: ReactNode }) {
  const { isAuthenticated, isLoading, isFetching } = useAuth();
  const { role, isLoading: isRoleLoading } = useRole();
  const waitingForRole = isAuthenticated && audience !== 'everyone' && isRoleLoading;

  if (isLoading || (!isAuthenticated && isFetching) || waitingForRole) {
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

  if (!canOpen(role, audience)) return <Navigate to={landingFor(role)} replace />;

  return <>{children}</>;
}
