import { useQuery } from '@tanstack/react-query';
import { getCompanyTokens, readEveryPage } from '@ledova/shared';
import apiClient from '@services/apiClient';

export function useTokensList(companyUuid?: string) {
  return useQuery({
    queryKey: ['tokens', 'company', companyUuid],
    enabled: !!companyUuid,
    queryFn: async () =>
      (await readEveryPage((page) => getCompanyTokens(apiClient, { page, company_uuid: companyUuid }))).filter(
        (token) => token.companyUuid === companyUuid,
      ),
  });
}
