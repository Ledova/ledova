import { useQuery } from '@tanstack/react-query';
import { getCompanyTokens, readEveryPage } from '@ledova/shared';
import { apiClient } from '../services/apiClient';

export const COMPANY_TOKENS_QUERY_KEY = ['company-tokens'] as const;

export function companyTokensKey(companyUuid: string | undefined, scopeKey: string) {
  return [...COMPANY_TOKENS_QUERY_KEY, 'company', companyUuid, scopeKey];
}

export function useCompanyTokens({
  companyUuid,
  scopeKey,
  company,
  readPage,
  enabled,
  staleTime,
}: {
  companyUuid: string | undefined;
  scopeKey: string;
  company: () => string;
  readPage: <Response>(load: () => Promise<Response>) => Promise<Response>;
  enabled: boolean;
  staleTime?: number;
}) {
  return useQuery({
    queryKey: companyTokensKey(companyUuid, scopeKey),
    enabled,
    queryFn: async () => {
      const rows = await readEveryPage((page) => readPage(() => getCompanyTokens(apiClient, { page })));
      return rows.filter((token) => token.companyUuid === company());
    },
    ...(staleTime === undefined ? {} : { staleTime }),
  });
}
