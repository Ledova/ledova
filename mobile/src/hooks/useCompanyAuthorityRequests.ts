import { useQuery } from '@tanstack/react-query';
import { getCompanyAuthorityRequests, readEveryPage } from '@ledova/shared';
import { apiClient } from '../services/apiClient';
import { assertSessionEpoch } from '../services/sessionScope';

export const COMPANY_AUTHORITY_REQUESTS_QUERY_KEY = ['company-authority-requests'] as const;

export function companyAuthorityRequestsKey(epoch: number) {
  return [...COMPANY_AUTHORITY_REQUESTS_QUERY_KEY, epoch];
}

export function useCompanyAuthorityRequests(epoch: number) {
  return useQuery({
    queryKey: companyAuthorityRequestsKey(epoch),
    queryFn: ({ signal }) =>
      readEveryPage(async (page) => {
        assertSessionEpoch(epoch);
        const response = await getCompanyAuthorityRequests(apiClient, undefined, page, {
          ledovaSessionEpoch: epoch,
          signal,
        });
        assertSessionEpoch(epoch);
        return response;
      }),
  });
}
