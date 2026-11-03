import { useUserPreferences, type OrderSubmissionOwner } from '@ledova/shared';
import { AccountCheck } from './AccountCheck';
import { CompanyContextNotice } from './CompanyContextNotice';
import { LoadError, Loading } from './Ledger';
import { useMemberRecordsState } from '../contexts';

export function RegisterAccess({ owner }: { owner: OrderSubmissionOwner | null }) {
  const preferences = useUserPreferences();
  const { directory } = useMemberRecordsState();
  return !owner || preferences.isError ? (
    <AccountCheck />
  ) : directory.hasError ? (
    <LoadError retry={directory.retry} busy={directory.isRefreshing}>
      Your company access could not be confirmed.
    </LoadError>
  ) : directory.isLoading ? (
    <Loading>Loading the register…</Loading>
  ) : (
    <CompanyContextNotice />
  );
}
