import { useQuery } from '@tanstack/react-query';
import type { OrderSubmissionOwner, OwnCompanyAppointment, CompanyShareTokenListItem } from '@ledova/shared';
import { registersQuery } from '@pages/company/shared/useCompanyRegister';

export function useLinkRegisters(
  owner: OrderSubmissionOwner,
  appointment: OwnCompanyAppointment | undefined,
  listed: CompanyShareTokenListItem[],
  guard: () => void,
) {
  const registers = useQuery(registersQuery(owner, appointment ? listed.map(({ uuid }) => uuid) : [], guard));
  return registers;
}
