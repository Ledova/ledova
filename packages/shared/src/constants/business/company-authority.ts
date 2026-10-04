import type { CompanyCapability } from '../../types';

export const COMPANY_AUTHORITY_DECLARATION_VERSION = '2026-10-04';

export const COMPANY_AUTHORITY_DECLARATION =
  'I am authorised to act for this company. The company is responsible for the company and share information it provides, its ASIC filings and legal obligations.';

export const COMPANY_AUTHORITY_CAPABILITIES = [
  { value: 'admin', label: 'Manage company information and team' },
  { value: 'prepare', label: 'Prepare register changes' },
  { value: 'approve', label: 'Approve register changes' },
  { value: 'apply', label: 'Apply authorised changes' },
  { value: 'finance', label: 'Manage company payments' },
  { value: 'read_register', label: 'Read company register' },
] as const satisfies readonly { value: CompanyCapability; label: string }[];
