import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { landingFor, useAuth } from '@ledova/shared';
import { useRole } from '@hooks/useRole';
import { FullScreenSpinner } from '@components/FullScreenSpinner';
import { ROOT_PATH } from '@utils/paths';

interface RouteGuardProps {
  children: ReactNode;
}

export function PublicOnlyRoute({ children, signIn = false }: RouteGuardProps & { signIn?: boolean }) {
  const { isAuthenticated, isLoading } = useAuth();
  const { role, isLoading: isRoleLoading } = useRole();
  if (isLoading || (isAuthenticated && isRoleLoading)) return <FullScreenSpinner />;
  if (isAuthenticated) return <Navigate to={signIn ? ROOT_PATH : landingFor(role)} replace />;
  return <>{children}</>;
}
