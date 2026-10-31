export const API_CONFIG = {
  DEFAULT_TIMEOUT: 30000,
} as const;

export const CACHE_TIMING = {
  VERY_SHORT_STALE_TIME: 30 * 1000,
  SHORT_STALE_TIME: 2 * 60 * 1000,
  DEFAULT_STALE_TIME: 5 * 60 * 1000,
  MEDIUM_GC_TIME: 5 * 60 * 1000,
  LONG_GC_TIME: 10 * 60 * 1000,
  EXTRA_LONG_GC_TIME: 24 * 60 * 60 * 1000,
} as const;

export const AUTH_ENDPOINTS = {
  SIGNIN: '/api/signin/',
  SIGNOUT: '/api/signout/',
  SIGNUP: '/api/signup/',
  RESTART_SIGNUP: '/api/restart-signup/',
  CHANGE_PASSWORD: '/api/change-password/',
  EMAIL_VERIFICATION: '/api/email-verification/',
  RESEND_VERIFICATION: '/api/resend-verification/',
  TOKEN_REFRESH: '/api/token/refresh/',
  VERIFY: '/api/auth/verify/',
} as const;
export const USER_PROFILE_ENDPOINTS = {
  BASE: '/api/user-profiles/',
  DETAIL: (uuid: string) => `/api/user-profiles/${uuid}/` as const,
  DELETE_ACCOUNT: '/api/user-profiles/delete-account/',
  EXPORT_DATA: '/api/user-profiles/export-data/',
} as const;
export const FINANCIAL_PROFILE_ENDPOINTS = {
  BASE: '/api/financial-profiles/',
  DETAIL: (uuid: string) => `/api/financial-profiles/${uuid}/` as const,
} as const;
export const USER_PREFERENCES_ENDPOINTS = { BASE: '/api/user-preferences/' } as const;
export const USER_ACCOUNT_ENDPOINTS = {
  BASE: '/api/user-accounts/',
  DETAIL: (uuid: string) => `/api/user-accounts/${uuid}/` as const,
} as const;
export const IDENTITY_VERIFICATION_ENDPOINTS = {
  TOKEN: '/api/users/identity-verification/token/',
  STATUS: '/api/users/identity-verification/status/',
} as const;
export const INVESTOR_CLASSIFICATION_ENDPOINTS = {
  BASE: '/api/investor-classifications/',
  DETAIL: (uuid: string) => `/api/investor-classifications/${uuid}/` as const,
} as const;
export const DEVICE_TOKEN_ENDPOINTS = {
  REGISTER: '/api/device-tokens/register/',
  UNREGISTER: '/api/device-tokens/unregister/',
} as const;

export const NOTIFICATION_ENDPOINTS = {
  BASE: '/api/notifications/',
  DETAIL: (uuid: string) => `/api/notifications/${uuid}/` as const,
  UNREAD_COUNT: '/api/notifications/unread-count/',
  MARK_ALL_READ: '/api/notifications/mark-all-read/',
} as const;

export const OPERATOR_ENDPOINTS = {
  BASE: '/api/operator/',
} as const;

export const COMPANY_ENDPOINTS = {
  PACK: (uuid: string) => `/api/v1/companies/${uuid}/pack/` as const,
  PACKS: (uuid: string) => `/api/v1/companies/${uuid}/packs/` as const,
  BASE: '/api/v1/companies/',
  DETAIL: (uuid: string) => `/api/v1/companies/${uuid}/` as const,
  DOCUMENTS: (uuid: string) => `/api/v1/companies/${uuid}/documents/` as const,
  DOCUMENT_DETAIL: (companyUuid: string, documentUuid: string) =>
    `/api/v1/companies/${companyUuid}/documents/${documentUuid}/` as const,
  ACTIVATE: (uuid: string) => `/api/v1/companies/${uuid}/activate/` as const,
} as const;

export const COMPANY_TOKEN_ENDPOINTS = {
  OWNERSHIP: '/api/v1/tokens/ownership/',
  OWNERSHIP_HOLDERS: (uuid: string) => `/api/v1/tokens/${uuid}/ownership-holders/` as const,
  CLASS_RIGHTS: (uuid: string) => `/api/v1/tokens/${uuid}/class-rights/` as const,
  CLASS_RIGHTS_FILE: (uuid: string) => `/api/v1/tokens/${uuid}/class-rights-file/` as const,
  REGISTER_CERTIFICATE: (uuid: string) => `/api/v1/tokens/${uuid}/register/certificate/` as const,
  MEMBER_CERTIFICATE_PREVIEW: (uuid: string) =>
    `/api/v1/tokens/member-certificate-requests/${uuid}/fulfilment-preview/` as const,
  MEMBER_CERTIFICATE_FULFIL: (uuid: string) => `/api/v1/tokens/member-certificate-requests/${uuid}/fulfil/` as const,
  MEMBER_CERTIFICATE_FILE: (uuid: string) => `/api/v1/tokens/member-certificate-requests/${uuid}/file/` as const,
  MEMBER_INVITATIONS: '/api/v1/tokens/member-invitations/',
  MEMBER_INVITATION_ACCEPT: '/api/v1/tokens/member-invitations/accept/',
  MEMBER_INVITATION_SEND_EMAIL: '/api/v1/tokens/member-invitations/send-email/',
  MEMBER_INVITATION_PREVIEW: '/api/v1/tokens/member-invitations/preview/',
  MEMBER_ASSOCIATIONS: '/api/v1/tokens/member-associations/',
  MEMBER_ASSOCIATION_REVOKE: (uuid: string) => `/api/v1/tokens/member-associations/${uuid}/revoke/` as const,
  MEMBER_RECORDS: '/api/v1/tokens/member-records/',
  MEMBER_RECORD: (uuid: string) => `/api/v1/tokens/member-records/${uuid}/` as const,
  MEMBER_ENTRIES: (uuid: string) => `/api/v1/tokens/member-records/${uuid}/entries/` as const,
  MEMBER_CERTIFICATE_REQUESTS: '/api/v1/tokens/member-certificate-requests/',
  MEMBER_CERTIFICATE_REQUEST_WITHDRAW: (uuid: string) =>
    `/api/v1/tokens/member-certificate-requests/${uuid}/withdraw/` as const,
  BASE: '/api/v1/tokens/',
  DETAIL: (uuid: string) => `/api/v1/tokens/${uuid}/` as const,
  REGISTER: '/api/v1/tokens/register/',
  HOLDERS: (uuid: string) => `/api/v1/tokens/${uuid}/holders/` as const,
  REGISTER_INSPECTION_COPY: (uuid: string) => `/api/v1/tokens/${uuid}/register/inspection-copy/` as const,
  REGISTER_INSPECTION_COPIES: (uuid: string) => `/api/v1/tokens/${uuid}/register/inspection-copies/` as const,
  REGISTER_ENTRIES: (uuid: string) => `/api/v1/tokens/${uuid}/register/entries/` as const,
  REGISTER_EVIDENCE: '/api/v1/tokens/register-evidence/',
  REGISTER_MEMBER_DOCUMENTS: '/api/v1/tokens/register-member-documents/',
  REGISTER_MEMBER_DOCUMENT_FILE: (uuid: string) => `/api/v1/tokens/register-member-documents/${uuid}/file/` as const,
  REGISTER_MEMBERS: (uuid: string) => `/api/v1/tokens/${uuid}/register/members/` as const,
  REGISTER_PEOPLE: '/api/v1/tokens/register-people/',
  REGISTER_TRANSFERS: '/api/v1/tokens/register-transfers/',
  REGISTER_TRANSFER_FILE: (uuid: string) => `/api/v1/tokens/register-transfers/${uuid}/file/` as const,
  REGISTER_TRANSFER_INSTRUMENT_FILE: (uuid: string) =>
    `/api/v1/tokens/register-transfers/${uuid}/instrument-file/` as const,
  REGISTER_TRANSFER_PREVIEW: (uuid: string) => `/api/v1/tokens/register-transfers/${uuid}/decision-preview/` as const,
  REGISTER_TRANSFER_DECIDE: (uuid: string) => `/api/v1/tokens/register-transfers/${uuid}/decide/` as const,
  REGISTER_ALLOTMENTS: '/api/v1/tokens/register-allotments/',
  REGISTER_ALLOTMENT: (uuid: string) => `/api/v1/tokens/register-allotments/${uuid}/` as const,
  REGISTER_ALLOTMENT_FILE: (uuid: string) => `/api/v1/tokens/register-allotments/${uuid}/file/` as const,
  REGISTER_ALLOTMENT_AGREEMENT_FILE: (uuid: string) =>
    `/api/v1/tokens/register-allotments/${uuid}/agreement-file/` as const,
  REGISTER_ALLOTMENT_RECEIPT_FILE: (uuid: string) =>
    `/api/v1/tokens/register-allotments/${uuid}/receipt-file/` as const,
  REGISTER_ALLOTMENT_PREVIEW: (uuid: string) => `/api/v1/tokens/register-allotments/${uuid}/decision-preview/` as const,
  REGISTER_ALLOTMENT_DECIDE: (uuid: string) => `/api/v1/tokens/register-allotments/${uuid}/decide/` as const,
  REGISTER_GRANTS: '/api/v1/tokens/register-grants/',
  REGISTER_AWARDS: '/api/v1/tokens/register-awards/',
  REGISTER_AWARD: (uuid: string) => `/api/v1/tokens/register-awards/${uuid}/` as const,
  REGISTER_AWARD_FILE: (uuid: string) => `/api/v1/tokens/register-awards/${uuid}/file/` as const,
  REGISTER_AWARD_VESTINGS: '/api/v1/tokens/register-award-vestings/',
  REGISTER_AWARD_VESTING: (uuid: string) => `/api/v1/tokens/register-award-vestings/${uuid}/` as const,
  REGISTER_AWARD_VESTING_FILE: (uuid: string) => `/api/v1/tokens/register-award-vestings/${uuid}/file/` as const,
  REGISTER_AWARD_ENDS: '/api/v1/tokens/register-award-ends/',
  REGISTER_AWARD_END: (uuid: string) => `/api/v1/tokens/register-award-ends/${uuid}/` as const,
  REGISTER_AWARD_END_FILE: (uuid: string) => `/api/v1/tokens/register-award-ends/${uuid}/file/` as const,
  REGISTER_AWARD_VESTING_REVERSALS: '/api/v1/tokens/register-award-vesting-reversals/',
  REGISTER_AWARD_VESTING_REVERSAL: (uuid: string) =>
    `/api/v1/tokens/register-award-vesting-reversals/${uuid}/` as const,
  REGISTER_AWARD_VESTING_REVERSAL_FILE: (uuid: string) =>
    `/api/v1/tokens/register-award-vesting-reversals/${uuid}/file/` as const,
  REGISTER_GRANT_FILE: (uuid: string) => `/api/v1/tokens/register-grants/${uuid}/file/` as const,
  REGISTER_GRANT_TERMS_FILE: (uuid: string) => `/api/v1/tokens/register-grants/${uuid}/terms-file/` as const,
  REGISTER_GRANT_ACCEPTANCE_FILE: (uuid: string) => `/api/v1/tokens/register-grants/${uuid}/acceptance-file/` as const,
  REGISTER_GRANT_PREVIEW: (uuid: string) => `/api/v1/tokens/register-grants/${uuid}/decision-preview/` as const,
  REGISTER_GRANT_DECIDE: (uuid: string) => `/api/v1/tokens/register-grants/${uuid}/decide/` as const,
  REGISTER_IMPORTS: '/api/v1/tokens/register-imports/',
  REGISTER_IMPORT_FILE: (uuid: string) => `/api/v1/tokens/register-imports/${uuid}/file/` as const,
  REGISTER_IMPORT_ASIC_FILE: (uuid: string) => `/api/v1/tokens/register-imports/${uuid}/asic-file/` as const,
  REGISTER_IMPORT_PREVIEW: (uuid: string) => `/api/v1/tokens/register-imports/${uuid}/decision-preview/` as const,
  REGISTER_IMPORT_DECIDE: (uuid: string) => `/api/v1/tokens/register-imports/${uuid}/decide/` as const,
  REGISTER_CORRECTIONS: '/api/v1/tokens/register-corrections/',
  REGISTER_CORRECTION_FILE: (uuid: string) => `/api/v1/tokens/register-corrections/${uuid}/file/` as const,
  REGISTER_CORRECTION_PREVIEW: (uuid: string) =>
    `/api/v1/tokens/register-corrections/${uuid}/decision-preview/` as const,
  REGISTER_CORRECTION_DECIDE: (uuid: string) => `/api/v1/tokens/register-corrections/${uuid}/decide/` as const,
  REGISTER_PARTICULARS_CHANGES: '/api/v1/tokens/register-particulars-changes/',
  REGISTER_PARTICULARS_CHANGE_FILE: (uuid: string) =>
    `/api/v1/tokens/register-particulars-changes/${uuid}/file/` as const,
  REGISTER_PARTICULARS_CHANGE_PREVIEW: (uuid: string) =>
    `/api/v1/tokens/register-particulars-changes/${uuid}/decision-preview/` as const,
  REGISTER_PARTICULARS_CHANGE_DECIDE: (uuid: string) =>
    `/api/v1/tokens/register-particulars-changes/${uuid}/decide/` as const,
} as const;

export const USER_DOCUMENT_ENDPOINTS = {
  BASE: '/api/v1/documents/',
  DETAIL: (uuid: string) => `/api/v1/documents/${uuid}/` as const,
  ATTACH: (uuid: string) => `/api/v1/documents/${uuid}/attach/` as const,
} as const;
