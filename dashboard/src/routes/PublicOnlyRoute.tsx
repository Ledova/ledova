import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@ledova/shared';
import { FullScreenSpinner } from '@components/FullScreenSpinner';
import { ROOT_PATH } from '@utils/paths';

export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <FullScreenSpinner />;
  if (isAuthenticated) return <Navigate to={ROOT_PATH} replace />;
  return <>{children}</>;
}
