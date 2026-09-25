import { Navigate } from 'react-router-dom';
import { landingFor } from '@ledova/shared';

import { useAuth, useRole } from '@hooks';

export function RootRedirect() {
  const { isAuthenticated, isLoading } = useAuth();
  const { role, isLoading: isRoleLoading } = useRole();
  if (isLoading || (isAuthenticated && isRoleLoading)) return null;
  if (isAuthenticated) return <Navigate to={landingFor(role)} replace />;
  return <Navigate to="/signin" replace />;
}
