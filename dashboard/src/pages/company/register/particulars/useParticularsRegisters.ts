import { useQueries } from '@tanstack/react-query';
import type { OrderSubmissionOwner } from '@ledova/shared';
import { registersQuery } from '@pages/company/shared/useCompanyRegister';

export function useParticularsRegisters(owner: OrderSubmissionOwner, preparing: { classes: string[] }[], guard: () => void) {
  const registers = useQueries({ queries: preparing.map((company) => registersQuery(owner, company.classes, guard)) });
  return registers;
}
