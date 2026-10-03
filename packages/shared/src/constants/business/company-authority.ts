import type { CompanyCapability } from '../../types';

export const COMPANY_AUTHORITY_CAPABILITIES = [
  { value: 'admin', label: 'Manage company team' },
  { value: 'prepare', label: 'Prepare register changes' },
  { value: 'approve', label: 'Approve register changes' },
  { value: 'apply', label: 'Apply authorised changes' },
  { value: 'finance', label: 'Manage company payments' },
  { value: 'read_register', label: 'Read company register' },
] as const satisfies readonly { value: CompanyCapability; label: string }[];
