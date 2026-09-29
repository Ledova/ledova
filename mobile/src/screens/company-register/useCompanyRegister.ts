import { useQuery } from '@tanstack/react-query';
import {
  getCompanyTokens,
  getCompanyTokenHolders,
  readEveryPage,
  useUserPreferences,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';

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
      const classes = await readEveryPage((page) => getCompanyTokens(apiClient, { page }));
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
