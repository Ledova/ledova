import type { OrderSubmissionOwner } from '@ledova/shared';
import { registerKey } from './useCompanyRegister';

export function particularsKey(owner: OrderSubmissionOwner, company: string) {
  return [...registerKey(owner), 'particulars', company];
}
