import { useQuery } from '@tanstack/react-query';
import type { OrderSubmissionOwner } from '@ledova/shared';
import { registersQuery } from '@pages/company/shared/useCompanyRegister';

export function useGrantRegisters(owner: OrderSubmissionOwner, companyClasses: string[]) {
  const registers = useQuery(registersQuery(owner, companyClasses));
  return registers;
}
