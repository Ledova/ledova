import { useAuth, useOperator } from '@ledova/shared';

export function useOperatorName(): string | null {
  const { isAuthenticated } = useAuth();
  const query = useOperator({ enabled: isAuthenticated });
  return query.data?.data?.name || null;
}
