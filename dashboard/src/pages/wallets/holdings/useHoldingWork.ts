import { useQuery } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  getPublications,
  getSubscriptions,
  readEveryPage,
  usePublicationSummary,
  SUBSCRIPTIONS_QUERY_KEY,
  PUBLICATIONS_QUERY_KEY,
} from '@ledova/shared';
import { useRole } from '@hooks/useRole';
import apiClient from '@services/apiClient';
import { applicationWork } from './applicationWork';

export function useHoldingWork() {
  const role = useRole();
  const notices = usePublicationSummary();
  const applications = useQuery({
    queryKey: [...SUBSCRIPTIONS_QUERY_KEY, 'holdings-work'],
    enabled: role.isKnown && role.isInvestor,
    queryFn: async () => applicationWork(await readEveryPage((page) => getSubscriptions(apiClient, page))),
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  const recent = useQuery({
    queryKey: [...PUBLICATIONS_QUERY_KEY, 'addressed', 'me', 'latest'],
    queryFn: async () => (await getPublications(apiClient, 1, { addressed: 'me' })).data.results.slice(0, 3),
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  return { role, notices, applications, recent };
}
