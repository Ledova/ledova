import { useUserPreferences } from '@ledova/shared';
import { LoadError, Loading } from './Ledger';

export function AccountCheck() {
  const preferences = useUserPreferences();
  return preferences.isLoading || preferences.isFetching ? (
    <Loading>Loading your account…</Loading>
  ) : (
    <LoadError retry={() => preferences.refetch()} busy={preferences.isFetching}>
      Your account could not be loaded.
    </LoadError>
  );
}
