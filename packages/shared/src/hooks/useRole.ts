import { canOpen } from '../constants/ui/destinations';
import type { AccountRole } from '../types';
import { useUserPreferences } from './useUserPreferences';

export function useRole() {
  const { userAccount, isLoading } = useUserPreferences();
  const role: AccountRole = userAccount?.role ?? 'investor';
  return { role, isCompany: canOpen(role, 'company'), isLoading };
}
