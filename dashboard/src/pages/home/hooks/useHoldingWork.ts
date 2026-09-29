import { useQuery } from '@tanstack/react-query';
import { CACHE_TIMING, getPublications, getSubscriptions, readEveryPage, usePublicationSummary } from '@ledova/shared';
import { useRole } from '@hooks/useRole';
import apiClient from '@services/apiClient';
import { applicationWork } from '../applicationWork';

export function useHoldingWork() {
  const role = useRole();
  const notices = usePublicationSummary();
  const applications = useQuery({
    queryKey: ['subscriptions', 'holdings-work'],
    enabled: role.isKnown && role.isInvestor,
    queryFn: async () => applicationWork(await readEveryPage((page) => getSubscriptions(apiClient, page))),
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  const recent = useQuery({
    queryKey: ['publications', 'addressed', 'me', 'latest'],
    queryFn: async () => (await getPublications(apiClient, 1, { addressed: 'me' })).data.results.slice(0, 3),
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  return { role, notices, applications, recent };
}
