export const API_CONFIG = {
  DEFAULT_TIMEOUT: 30000,
} as const;

export const CACHE_TIMING = {
  VERY_SHORT_STALE_TIME: 30 * 1000,
  SHORT_STALE_TIME: 2 * 60 * 1000,
  DEFAULT_STALE_TIME: 5 * 60 * 1000,
  LONG_STALE_TIME: 10 * 60 * 1000,
  DEFAULT_GC_TIME: 2 * 60 * 1000,
  MEDIUM_GC_TIME: 5 * 60 * 1000,
  LONG_GC_TIME: 10 * 60 * 1000,
  EXTRA_LONG_GC_TIME: 24 * 60 * 60 * 1000,
} as const;

export const AUTH_ENDPOINTS = {
  SIGNIN: '/api/signin/',
  SIGNOUT: '/api/signout/',
  SIGNUP: '/api/signup/',
  CHANGE_PASSWORD: '/api/change-password/',
  EMAIL_VERIFICATION: '/api/email-verification/',
  RESEND_VERIFICATION: '/api/resend-verification/',
  TOKEN_REFRESH: '/api/token/refresh/',
  VERIFY: '/api/auth/verify/',
} as const;
export const ASSET_ENDPOINTS = {
  BASE: '/api/assets/',
  EXCHANGE_RATES: '/api/assets/exchange-rates/',
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
  ELIGIBILITY: '/api/investor-classifications/eligibility/',
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

export const FEATURE_FLAG_ENDPOINTS = {
  BASE: '/api/feature-flags/',
} as const;

export const OPERATOR_ENDPOINTS = {
  BASE: '/api/operator/',
} as const;

export const COMPANY_ENDPOINTS = {
  BASE: '/api/v1/companies/',
  DETAIL: (uuid: string) => `/api/v1/companies/${uuid}/` as const,
  DOCUMENTS: (uuid: string) => `/api/v1/companies/${uuid}/documents/` as const,
  DOCUMENT_DETAIL: (companyUuid: string, documentUuid: string) =>
    `/api/v1/companies/${companyUuid}/documents/${documentUuid}/` as const,
  ACTIVATE: (uuid: string) => `/api/v1/companies/${uuid}/activate/` as const,
} as const;

export const COMPANY_TOKEN_ENDPOINTS = {
  REGISTER_PAID_ISSUES: '/api/v1/tokens/register-paid-issues/',
  REGISTER_PAID_ISSUE_SUBSCRIPTIONS: '/api/v1/tokens/register-paid-issues/ready-subscriptions/',
  REGISTER_PAID_ISSUE: (uuid: string) => `/api/v1/tokens/register-paid-issues/${uuid}/`,
  REGISTER_PAID_ISSUE_FILE: (uuid: string) => `/api/v1/tokens/register-paid-issues/${uuid}/file/`,
  REGISTER_PAID_ISSUE_PREVIEW: (uuid: string) => `/api/v1/tokens/register-paid-issues/${uuid}/decision-preview/`,
  REGISTER_PAID_ISSUE_DECIDE: (uuid: string) => `/api/v1/tokens/register-paid-issues/${uuid}/decide/`,
  BASE: '/api/v1/tokens/',
  DETAIL: (uuid: string) => `/api/v1/tokens/${uuid}/` as const,
  PAUSE: (uuid: string) => `/api/v1/tokens/${uuid}/pause/` as const,
  UNPAUSE: (uuid: string) => `/api/v1/tokens/${uuid}/unpause/` as const,
  PAUSE_SUBMISSION: (uuid: string, submissionId: string) =>
    `/api/v1/tokens/${uuid}/pause-submissions/${submissionId}/` as const,
  REGISTER: '/api/v1/tokens/register/',
  HOLDERS: (uuid: string) => `/api/v1/tokens/${uuid}/holders/` as const,
  REGISTER_EXPORT: (uuid: string) => `/api/v1/tokens/${uuid}/register/export/` as const,
  REGISTER_INSPECTION_COPY: (uuid: string) => `/api/v1/tokens/${uuid}/register/inspection-copy/` as const,
  REGISTER_ENTRIES: (uuid: string) => `/api/v1/tokens/${uuid}/register/entries/` as const,
  REGISTER_OPENING_HOLDERS: (uuid: string) => `/api/v1/tokens/${uuid}/register/opening-holders/` as const,
  REGISTER_EVIDENCE: '/api/v1/tokens/register-evidence/',
  REGISTER_DEPLOYMENTS: '/api/v1/tokens/register-deployments/',
  REGISTER_DEPLOYMENT_DETAIL: (uuid: string) => `/api/v1/tokens/register-deployments/${uuid}/` as const,
  REGISTER_DEPLOYMENT_PREVIEW: (uuid: string) =>
    `/api/v1/tokens/register-deployments/${uuid}/decision-preview/` as const,
  REGISTER_DEPLOYMENT_DECIDE: (uuid: string) => `/api/v1/tokens/register-deployments/${uuid}/decide/` as const,
  REGISTER_MEMBERS: (uuid: string) => `/api/v1/tokens/${uuid}/register/members/` as const,
  REGISTER_TRANSFERS: '/api/v1/tokens/register-transfers/',
  REGISTER_TRANSFER_FILE: (uuid: string) => `/api/v1/tokens/register-transfers/${uuid}/file/` as const,
  REGISTER_TRANSFER_INSTRUMENT_FILE: (uuid: string) =>
    `/api/v1/tokens/register-transfers/${uuid}/instrument-file/` as const,
  REGISTER_TRANSFER_PREVIEW: (uuid: string) => `/api/v1/tokens/register-transfers/${uuid}/decision-preview/` as const,
  REGISTER_TRANSFER_DECIDE: (uuid: string) => `/api/v1/tokens/register-transfers/${uuid}/decide/` as const,
  REGISTER_GRANTS: '/api/v1/tokens/register-grants/',
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
  REGISTER_LINKS: '/api/v1/tokens/register-links/',
  REGISTER_LINK_WAITING_WALLETS: '/api/v1/tokens/register-links/waiting-wallets/',
  REGISTER_LINK_FILE: (uuid: string) => `/api/v1/tokens/register-links/${uuid}/file/` as const,
  REGISTER_LINK_PREVIEW: (uuid: string) => `/api/v1/tokens/register-links/${uuid}/decision-preview/` as const,
  REGISTER_LINK_DECIDE: (uuid: string) => `/api/v1/tokens/register-links/${uuid}/decide/` as const,
  REGISTER_OPENINGS: '/api/v1/tokens/register-openings/',
  REGISTER_OPENING_FILE: (uuid: string) => `/api/v1/tokens/register-openings/${uuid}/file/` as const,
  REGISTER_OPENING_PREVIEW: (uuid: string) => `/api/v1/tokens/register-openings/${uuid}/decision-preview/` as const,
  REGISTER_OPENING_DECIDE: (uuid: string) => `/api/v1/tokens/register-openings/${uuid}/decide/` as const,
  REGISTER_PARTICULARS_CHANGES: '/api/v1/tokens/register-particulars-changes/',
  REGISTER_PARTICULARS_CHANGE_FILE: (uuid: string) =>
    `/api/v1/tokens/register-particulars-changes/${uuid}/file/` as const,
  REGISTER_PARTICULARS_CHANGE_PREVIEW: (uuid: string) =>
    `/api/v1/tokens/register-particulars-changes/${uuid}/decision-preview/` as const,
  REGISTER_PARTICULARS_CHANGE_DECIDE: (uuid: string) =>
    `/api/v1/tokens/register-particulars-changes/${uuid}/decide/` as const,
  REGISTER_RECONCILIATIONS: '/api/v1/tokens/register-reconciliations/',
  REGISTER_RECONCILIATION_ACKNOWLEDGE: (uuid: string) =>
    `/api/v1/tokens/register-reconciliations/${uuid}/acknowledge/` as const,
  REGISTER_ISSUES: '/api/v1/tokens/register-issues/',
  REGISTER_ISSUE_PREVIEW: (uuid: string) => `/api/v1/tokens/register-issues/${uuid}/decision-preview/` as const,
  REGISTER_ISSUE_DECIDE: (uuid: string) => `/api/v1/tokens/register-issues/${uuid}/decide/` as const,
  REGISTER_ISSUE_FILE: (uuid: string) => `/api/v1/tokens/register-issues/${uuid}/file/` as const,
  REGISTER_ISSUE_TERMS_FILE: (uuid: string) => `/api/v1/tokens/register-issues/${uuid}/terms-file/` as const,
  REGISTER_ISSUE_ACCEPTANCE_FILE: (uuid: string) => `/api/v1/tokens/register-issues/${uuid}/acceptance-file/` as const,
  ISSUANCES: (uuid: string) => `/api/v1/tokens/${uuid}/issuances/` as const,
  REGISTER_CAPITAL_INCREASES: '/api/v1/tokens/register-capital-increases/',
  REGISTER_CAPITAL_INCREASE: (uuid: string) => `/api/v1/tokens/register-capital-increases/${uuid}/` as const,
  REGISTER_CAPITAL_INCREASE_PREVIEW: (uuid: string) =>
    `/api/v1/tokens/register-capital-increases/${uuid}/decision-preview/` as const,
  REGISTER_CAPITAL_INCREASE_DECIDE: (uuid: string) =>
    `/api/v1/tokens/register-capital-increases/${uuid}/decide/` as const,
  REGISTER_CAPITAL_INCREASE_FILE: (uuid: string) => `/api/v1/tokens/register-capital-increases/${uuid}/file/` as const,
  REGISTER_PAUSE_CHANGES: '/api/v1/tokens/register-pause-changes/',
  REGISTER_PAUSE_CHANGE: (uuid: string) => `/api/v1/tokens/register-pause-changes/${uuid}/` as const,
  REGISTER_PAUSE_CHANGE_PREVIEW: (uuid: string) =>
    `/api/v1/tokens/register-pause-changes/${uuid}/decision-preview/` as const,
  REGISTER_PAUSE_CHANGE_DECIDE: (uuid: string) => `/api/v1/tokens/register-pause-changes/${uuid}/decide/` as const,
  REGISTER_PAUSE_CHANGE_FILE: (uuid: string) => `/api/v1/tokens/register-pause-changes/${uuid}/file/` as const,
  CAPITAL_INCREASES: '/api/v1/tokens/capital-increases/',
  ISSUANCE_REQUESTS: '/api/v1/tokens/issuance-requests/',
} as const;

export const WALLET_ENDPOINTS = {
  BASE: '/api/wallets/',
  DETAIL: (uuid: string) => `/api/wallets/${uuid}/` as const,
  HOLDINGS: (uuid: string) => `/api/wallets/${uuid}/holdings/` as const,
  BATCH_BALANCES: '/api/wallets/batch-check-balances/',
  REQUEST_VERIFICATION: (uuid: string) => `/api/wallets/${uuid}/request-verification/` as const,
  VERIFY_SIGNATURE: (uuid: string) => `/api/wallets/${uuid}/verify-signature/` as const,
  SYNC: (uuid: string) => `/api/wallets/${uuid}/sync/` as const,
  PREPARE_TRANSFER: (uuid: string) => `/api/wallets/${uuid}/prepare-transfer/` as const,
  BROADCAST_TRANSFER: (uuid: string) => `/api/wallets/${uuid}/broadcast-transfer/` as const,
} as const;

export const TRANSACTION_ENDPOINTS = {
  BASE: '/api/transactions/',
} as const;

export const ONRAMP_ENDPOINTS = {
  WIDGET_URL: '/api/fiat-purchases/transak-widget-url/',
} as const;
