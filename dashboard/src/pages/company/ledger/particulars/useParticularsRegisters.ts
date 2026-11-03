import { useQueries } from '@tanstack/react-query';
import { READ_TIMING, type OrderSubmissionOwner } from '@ledova/shared';
import { registersQuery } from '@pages/company/shared/useCompanyRegister';
import { peopleKey, readPeople } from '@pages/company/ledger/shared/usePeople';

export function useParticularsRegisters(
  owner: OrderSubmissionOwner,
  editing: { classes: string[] }[],
  guard: () => void,
) {
  const registers = useQueries({ queries: editing.map((company) => registersQuery(owner, company.classes, guard)) });
  const people = useQueries({
    queries: editing.map((company) => ({
      queryKey: peopleKey(owner, company.classes[0] ?? ''),
      enabled: company.classes.length > 0,
      queryFn: () => readPeople(company.classes[0], guard),
      ...READ_TIMING,
      refetchOnMount: 'always' as const,
    })),
  });
  return { registers, people };
}
