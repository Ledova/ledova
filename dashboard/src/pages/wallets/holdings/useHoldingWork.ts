import { useQuery } from '@tanstack/react-query';
import { CACHE_TIMING, getPublications, usePublicationSummary, PUBLICATIONS_QUERY_KEY } from '@ledova/shared';
import apiClient from '@services/apiClient';

export function useHoldingWork() {
  const notices = usePublicationSummary();
  const recent = useQuery({
    queryKey: [...PUBLICATIONS_QUERY_KEY, 'addressed', 'me', 'latest'],
    queryFn: async () => (await getPublications(apiClient, 1, { addressed: 'me' })).data.results.slice(0, 3),
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  return { notices, recent };
}
