import { useMemo } from 'react';
import type { OwnershipCompany } from './useOwnershipCompanies';
import { useRegisterClasses } from './useRegisterClasses';
import { useSubmissionOwner, type OrderSubmissionSession } from './useSubmissionOwner';

export function useLedgerSetupDue(
  company: Pick<OwnershipCompany, 'uuid' | 'canManage' | 'canReadRegister'> | null | undefined,
  enabled = true,
  session?: OrderSubmissionSession,
) {
  const { owner, boundary } = useSubmissionOwner(session);
  const guard = useMemo(
    () => () => {
      if (boundary.get() !== owner) throw new Error('Your signed-in account changed. Reopen the menu.');
    },
    [boundary, owner],
  );
  const manages = !!company?.canManage && !!company.canReadRegister;
  const classes = useRegisterClasses(owner, guard, session, enabled && manages);
  return manages && classes.isSuccess && !classes.data.some((row) => row.companyUuid === company.uuid);
}
