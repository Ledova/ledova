import { AccountRole, canOpen, useUserPreferences } from '@ledova/shared';

export type { AccountRole };

export function useRole() {
  const { userAccount, isLoading } = useUserPreferences();

  const role: AccountRole = userAccount?.role ?? 'investor';

  return {
    role,
    isInvestor: canOpen(role, 'investing'),
    isCompany: canOpen(role, 'company'),
    isLoading,
  };
}
