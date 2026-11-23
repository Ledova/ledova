import { useUserPreferences, type OrderSubmissionOwner } from '@ledova/shared';
import { useMemberRecordsState } from '../contexts/index';
import { useRetainedScope } from './useRetainedScope';

export function useCompanyPageScope(
  owner: OrderSubmissionOwner | null,
  currentOwner: () => OrderSubmissionOwner | null,
) {
  const { directory, companies, company, companySelection } = useMemberRecordsState();
  const preferences = useUserPreferences();
  const choosing =
    directory.isLoading || directory.isRefreshing || preferences.isFetching || (!company && companies.length > 0);
  const scope = useRetainedScope(
    owner,
    currentOwner,
    company?.uuid,
    !preferences.isError && !!company?.canReadRegister && !directory.hasError && !choosing,
    companySelection,
  );
  return { scope, choosing, directory };
}
