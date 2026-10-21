import { useQueries } from '@tanstack/react-query';
import type { OrderSubmissionOwner } from '@ledova/shared';
import { READ_TIMING } from '@hooks/useRegisterAccess';
import { registersQuery } from '@pages/company/shared/useCompanyRegister';
import { peopleKey, readPeople } from '@pages/company/ledger/shared/usePeople';

export function useParticularsRegisters(
  owner: OrderSubmissionOwner,
  preparing: { classes: string[] }[],
  guard: () => void,
) {
  const registers = useQueries({ queries: preparing.map((company) => registersQuery(owner, company.classes, guard)) });
  const people = useQueries({
    queries: preparing.map((company) => ({
      queryKey: peopleKey(owner, company.classes[0] ?? ''),
      enabled: company.classes.length > 0,
      queryFn: () => readPeople(company.classes[0], guard),
      ...READ_TIMING,
    })),
  });
  return { registers, people };
}
