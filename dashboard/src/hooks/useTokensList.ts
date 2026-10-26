import { useQuery } from '@tanstack/react-query';
import { getCompanyTokens, readEveryPage } from '@ledova/shared';
import apiClient from '@services/apiClient';
import type { useCompanySelection } from '@ledova/shared';

type CompanyActionRead = Pick<
  ReturnType<typeof useCompanySelection>,
  'scopeKey' | 'error' | 'isRefreshing' | 'assertCurrent'
>;

export const TOKENS_QUERY_KEY = ['tokens'] as const;

export function companyTokensKey(companyUuid: string | undefined, scopeKey: string) {
  return [...TOKENS_QUERY_KEY, 'company', companyUuid, scopeKey];
}

export function useTokensList(companyUuid: string | undefined, read: CompanyActionRead) {
  return useQuery({
    queryKey: companyTokensKey(companyUuid, read.scopeKey),
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
