import { useQuery } from '@tanstack/react-query';
import {
  CACHE_TIMING,
  getCompanyTokens,
  getCompanyTokenHolders,
  getNextPageParam,
  type CompanyShareTokenListItem,
} from '@ledova/shared';
import { useRole } from '@hooks/useRole';
import apiClient from '@services/apiClient';

export function useCompanyRegister() {
  const { isKnown, isCompany } = useRole();

  return useQuery({
    queryKey: ['tokens', 'register'],
    enabled: isKnown && isCompany,
    queryFn: async () => {
      const classes: CompanyShareTokenListItem[] = [];
      let page: number | undefined = 1;

      while (page !== undefined) {
        const { data } = await getCompanyTokens(apiClient, { page });
        classes.push(...data.results);
        const next = getNextPageParam(data);
        if (next !== undefined && (!Number.isInteger(next) || next <= page)) {
          throw new Error('Share class pagination did not advance');
        }
        page = next;
      }

      return Promise.all(
        classes.map(async (shareClass) => {
          const { data: register } = await getCompanyTokenHolders(apiClient, shareClass.uuid);
          const quantities = [register.token.totalSupply, ...register.holders.map(({ balance }) => balance)];
          if (register.issuedSupply !== null) quantities.push(register.issuedSupply);
          if (register.token.uuid !== shareClass.uuid || quantities.some((value) => !/^\d+$/.test(value))) {
            throw new Error('Register did not identify exact share quantities for this class');
          }
          return { companyName: shareClass.companyName, register };
        }),
      );
    },
    staleTime: CACHE_TIMING.SHORT_STALE_TIME,
    gcTime: CACHE_TIMING.MEDIUM_GC_TIME,
  });
}
