import { useQuery } from '@tanstack/react-query';
import type { OrderSubmissionOwner, CompanyShareTokenListItem } from '@ledova/shared';
import { registersQuery } from '@pages/company/shared/useCompanyRegister';

export function useTransferRegister(
  owner: OrderSubmissionOwner,
  uuid: string,
  listed: CompanyShareTokenListItem | undefined,
) {
  const registers = useQuery(registersQuery(owner, listed ? [uuid] : []));
  return registers;
}
