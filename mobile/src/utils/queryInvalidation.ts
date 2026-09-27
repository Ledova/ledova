import type { QueryClient } from '@tanstack/react-query';

export function invalidateHomeDashboard(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['wallets', 'share-holdings'] });
  queryClient.invalidateQueries({ queryKey: ['holdings'] });
  queryClient.invalidateQueries({ queryKey: ['portfolio-snapshots'] });
  queryClient.invalidateQueries({ queryKey: ['home-transactions'] });
}
