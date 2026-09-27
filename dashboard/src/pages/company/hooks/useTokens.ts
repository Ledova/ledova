import { useQuery } from '@tanstack/react-query';
import { getCompanyTokens, getNextPageParam, type CompanyShareTokenListItem } from '@ledova/shared';
import apiClient from '@services/apiClient';

export function useTokensList(companyUuid?: string) {
  return useQuery({
    queryKey: ['tokens', 'company', companyUuid],
    enabled: !!companyUuid,
    queryFn: async () => {
      const tokens: CompanyShareTokenListItem[] = [];
      let page: number | undefined = 1;
      while (page !== undefined) {
        const { data } = await getCompanyTokens(apiClient, { page, company_uuid: companyUuid });
        tokens.push(...data.results.filter((token) => token.companyUuid === companyUuid));
        const next = getNextPageParam(data);
        if (data.next && (next === undefined || !Number.isInteger(next) || next <= page)) {
          throw new Error('Company share class pagination did not advance');
        }
        page = next;
      }
      return tokens;
    },
  });
}
