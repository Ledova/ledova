import { useQuery } from '@tanstack/react-query';
import {
  getCompanyTokens,
  getCompanyTokenHolders,
  getNextPageParam,
  type PaginatedResponse,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { useUserPreferences } from '../../hooks/useUserPreferences';

export async function everyCompanyPage<T>(
  read: (page: number) => Promise<{ data: PaginatedResponse<T> }>,
): Promise<T[]> {
  const rows: T[] = [];
  let page: number | undefined = 1;
  while (page !== undefined) {
    const { data } = await read(page);
    rows.push(...data.results);
    const next = getNextPageParam(data);
    if (data.next && (next === undefined || !Number.isInteger(next) || next <= page)) {
      throw new Error('Company pagination did not advance');
    }
    page = next;
  }
  return rows;
}

export function checkedRegister(uuid: string, register: TokenHoldersResponse) {
  const quantities = [register.token.totalSupply, ...register.holders.map(({ balance }) => balance)];
  if (register.issuedSupply !== null) quantities.push(register.issuedSupply);
  if (register.token.uuid !== uuid || quantities.some((value) => !/^\d+$/.test(value))) {
    throw new Error('Register quantities do not identify this share class');
  }
  return register;
}

export function useCompanyAccess() {
  const preferences = useUserPreferences();
  const role = preferences.userAccount?.role;
  return { ...preferences, allowed: !preferences.isError && (role === 'company' || role === 'both') };
}

export function useCompanyRegister() {
  const access = useCompanyAccess();
  const query = useQuery({
    queryKey: ['company-tokens', 'register'],
    enabled: access.allowed,
    queryFn: async () => {
      const classes = await everyCompanyPage((page) => getCompanyTokens(apiClient, { page }));
      return Promise.all(
        classes.map(async (shareClass) => ({
          companyName: shareClass.companyName,
          register: checkedRegister(shareClass.uuid, (await getCompanyTokenHolders(apiClient, shareClass.uuid)).data),
        })),
      );
    },
  });
  return { access, query };
}
