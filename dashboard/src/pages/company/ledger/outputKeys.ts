import type { OrderSubmissionOwner } from '@ledova/shared';
import { registerKey } from '@hooks/useRegisterAccess';

export function inspectionCopiesKey(owner: OrderSubmissionOwner, token: string) {
  return [...registerKey(owner), 'inspection-copies', token];
}

export function companyPacksKey(owner: OrderSubmissionOwner, company: string) {
  return [...registerKey(owner), 'company-packs', company];
}
