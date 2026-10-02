import type { DocumentType } from '../../types/domain/company';

export const REQUIRED_DOCUMENTS: { type: DocumentType; label: string }[] = [
  { type: 'cert_inc', label: 'Certificate of Incorporation' },
  { type: 'asic', label: 'ASIC Company Extract' },
  { type: 'constitution', label: 'Company Constitution' },
  { type: 'share_register', label: 'Current Share Register' },
  { type: 'financials', label: 'Financial Statements' },
  { type: 'director_id', label: 'Director Identification' },
  { type: 'beneficial_ownership', label: 'Beneficial Ownership Declaration' },
  { type: 'business_plan', label: 'Business Plan' },
  { type: 'risk_disclosure', label: 'Risk Disclosure Statement' },
];

export const OPTIONAL_DOCUMENTS: { type: DocumentType; label: string }[] = [
  { type: 'auditor_report', label: 'Auditor Report' },
  { type: 'shareholder', label: 'Shareholder Agreement' },
  { type: 'prospectus', label: 'Prospectus' },
  { type: 'legal_opinion', label: 'Legal Opinion' },
  { type: 'tax_return', label: 'Tax Return' },
  { type: 'bank_statement', label: 'Bank Statement' },
  { type: 'other', label: 'Other documents' },
];

export const OFFER_DOCUMENT_TYPES: readonly DocumentType[] = [
  'prospectus',
  'risk_disclosure',
  'business_plan',
  'financials',
  'auditor_report',
  'constitution',
  'shareholder',
];
