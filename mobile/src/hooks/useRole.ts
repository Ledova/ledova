import { AccountRole, useUserPreferences } from '@ledova/shared';

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
