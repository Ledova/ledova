import { useQuery } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  getNextPageParam,
  getPublications,
  getSubscriptions,
  usePublicationSummary,
  type Subscription,
} from '@ledova/shared';
import { useRole } from '@hooks/useRole';
import apiClient from '@services/apiClient';
import { applicationWork } from '../applicationWork';

export function useHoldingWork() {
  const role = useRole();
  const notices = usePublicationSummary();
  const applications = useQuery({
    queryKey: ['subscriptions', 'holdings-work'],
    enabled: role.isKnown && role.isInvestor,
    queryFn: async () => {
      const all: Subscription[] = [];
      let page: number | undefined = 1;

      while (page !== undefined) {
        const { data } = await getSubscriptions(apiClient, page);
        all.push(...data.results);
        const next = getNextPageParam(data);
        if (data.next && (next === undefined || !Number.isInteger(next) || next <= page)) {
          throw new Error('Application pagination did not advance');
        }
        page = next;
      }

      return applicationWork(all);
    },
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  const recent = useQuery({
    queryKey: ['publications', 'addressed', 'me', 'latest'],
    queryFn: async () => (await getPublications(apiClient, 1, { addressed: 'me' })).data.results.slice(0, 3),
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
  });

  return { role, notices, applications, recent };
}
