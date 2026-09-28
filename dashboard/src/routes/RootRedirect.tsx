import { Navigate } from 'react-router-dom';
import { landingFor, useAuth } from '@ledova/shared';

import { useRole } from '@hooks/useRole';

export function RootRedirect() {
  const { isAuthenticated, isLoading } = useAuth();
  const { role, isLoading: isRoleLoading } = useRole();
  if (isLoading || (isAuthenticated && isRoleLoading)) return null;
  if (isAuthenticated) return <Navigate to={landingFor(role)} replace />;
  return <Navigate to="/signin" replace />;
}
