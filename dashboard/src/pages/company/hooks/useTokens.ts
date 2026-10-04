import { useQuery } from '@tanstack/react-query';
import { getCompanyTokens, readEveryPage } from '@ledova/shared';
import apiClient from '@services/apiClient';
import type { CompanyActionRead } from '../CompanyState';

export function useTokensList(companyUuid: string | undefined, read: CompanyActionRead) {
  return useQuery({
    queryKey: ['tokens', 'company', companyUuid, read.scopeKey],
    enabled: !!companyUuid && !read.error && !read.isRefreshing,
    queryFn: async () =>
      (
        await readEveryPage(async (page) => {
          read.assertCurrent(companyUuid!, 'owner');
          const result = await getCompanyTokens(apiClient, { page, company_uuid: companyUuid });
          read.assertCurrent(companyUuid!, 'owner');
          return result;
        })
      ).filter((token) => token.companyUuid === companyUuid),
  });
}
