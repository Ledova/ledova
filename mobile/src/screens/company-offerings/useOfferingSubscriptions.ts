import { useQuery } from '@tanstack/react-query';
import { CACHE_TIMING, getOfferingSubscriptions, readEveryPage, type OfferingListItem } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import type { CompanyActionRead } from '../../components/company/CompanyState';

export const OFFERING_SUBSCRIPTIONS_QUERY_KEY = ['offering-subscriptions'] as const;

export function offeringSubscriptionsKey(uuid: string | undefined, scopeKey: string) {
  return [...OFFERING_SUBSCRIPTIONS_QUERY_KEY, uuid, scopeKey];
}

export function useOfferingSubscriptions(offering: OfferingListItem | undefined, companyRead: CompanyActionRead) {
  return useQuery({
    queryKey: offeringSubscriptionsKey(offering?.uuid, companyRead.scopeKey),
    enabled: !!offering && companyRead.ownerBusiness,
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
    queryFn: () =>
      readEveryPage(async (page) => {
        companyRead.assertCurrent(companyRead.companyUuid!, 'owner');
        const result = await getOfferingSubscriptions(apiClient, offering!.uuid, page);
        companyRead.assertCurrent(companyRead.companyUuid!, 'owner');
        return result;
      }),
  });
}
