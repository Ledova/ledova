import type { ApiComponents } from '../../generated/api';

export type OfferingStatus = ApiComponents['schemas']['OfferingStatusEnum'];

export type OfferingExemption = ApiComponents['schemas']['ExemptionEnum'];

export const DIRECTORY_ENDPOINTS = {
  TOKENS: {
    LIST: '/api/v1/directory/tokens/',
    DETAIL: (uuid: string) => `/api/v1/directory/tokens/${uuid}/` as const,
  },
} as const;

export const OFFERING_ENDPOINTS = {
  BASE: '/api/v1/offerings/',
  DETAIL: (uuid: string) => `/api/v1/offerings/${uuid}/` as const,
  SUBMIT: (uuid: string) => `/api/v1/offerings/${uuid}/submit/` as const,
  WITHDRAW: (uuid: string) => `/api/v1/offerings/${uuid}/withdraw/` as const,
  SUBSCRIPTIONS: (uuid: string) => `/api/v1/offerings/${uuid}/subscriptions/` as const,
} as const;

export const OFFERING_EXEMPTION_LABELS: Record<OfferingExemption, string> = {
  s708_8_minimum_amount: 'Minimum amount of AUD 500,000 (s708(8)(a))',
  s708_8_net_assets: 'Net assets certified by a qualified accountant (s708(8)(c))',
  s708_8_gross_income: 'Gross income certified by a qualified accountant (s708(8)(c))',
  s708_11_professional: 'Professional investor (s708(11))',
  s761g_wholesale_client: 'Wholesale client (s761G)',
};

export const OFFERING_WITHDRAWABLE_STATUSES: OfferingStatus[] = ['draft', 'submitted', 'under_review', 'rejected'];

export const DIRECTORY_COPY = {
  INELIGIBLE_TITLE: 'Verify your investor status to see the directory',
  MARKET_INELIGIBLE_BODY:
    'The market list is limited to verified wholesale and sophisticated investors. Once your classification is ' +
    'verified, every deployed share class appears here, whether or not its issuer is listed in the directory.',
  MARKET_EMPTY_TITLE: 'No share classes are trading yet',
  MARKET_EMPTY_BODY:
    'No company has deployed a share class on this platform yet. The market lists every deployed share class, ' +
    'so this is empty only because none exists.',
} as const;
