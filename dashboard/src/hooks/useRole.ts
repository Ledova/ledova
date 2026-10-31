import { canOpen, useUserPreferences, type AccountRole } from '@ledova/shared';

export function useRole() {
  const preferences = useUserPreferences();
  const account = preferences.userAccount;
  const role: AccountRole = account?.role ?? 'investor';

  return {
    role,
    isInvestor: canOpen(role, 'investing'),
    isCompany: canOpen(role, 'company'),
    isLoading: preferences.isLoading,
    isKnown: !!account,
  };
}
