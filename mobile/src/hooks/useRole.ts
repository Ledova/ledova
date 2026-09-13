import { AccountRole } from '@ledova/shared';

import { useUserPreferences } from './useUserPreferences';

export type { AccountRole };

export function useRole() {
  const { userAccount, isLoading } = useUserPreferences();

  const role: AccountRole = userAccount?.role ?? 'investor';

  return {
    role,
    isInvestor: role === 'investor' || role === 'both',
    isCompany: role === 'company' || role === 'both',
    isLoading,
  };
}
