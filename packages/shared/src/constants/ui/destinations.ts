import type { AccountRole } from '../../types/domain/user-preferences';

export type Audience = 'everyone' | 'investing' | 'company';

export interface Destination {
  path: string;
  title: string;
  subtitle?: string;
  audience: Audience;
}

export const DESTINATIONS = {
  home: { path: '/home', title: 'Home', subtitle: 'Overview of your portfolio', audience: 'everyone' },
  wallets: { path: '/wallets', title: 'Wallets', subtitle: 'Manage your digital asset wallets', audience: 'everyone' },
  transactions: {
    path: '/transactions',
    title: 'Transactions',
    subtitle: 'View your transaction history',
    audience: 'everyone',
  },
  assetPrices: { path: '/asset-prices', title: 'Market', subtitle: 'Browse asset prices', audience: 'investing' },
  trading: { path: '/trading', title: 'Trading', subtitle: 'Buy and sell assets', audience: 'investing' },
  directory: { path: '/directory', title: 'Directory', audience: 'investing' },
  directoryDetail: { path: '/directory/:uuid', title: 'Directory', audience: 'investing' },
  subscriptions: { path: '/subscriptions', title: 'Subscriptions', audience: 'investing' },
  subscriptionDetail: { path: '/subscriptions/:uuid', title: 'Subscription', audience: 'investing' },
  investorEligibility: {
    path: '/investor-eligibility',
    title: 'Eligibility',
    subtitle: 'Evidence your wholesale investor status',
    audience: 'investing',
  },
  publications: { path: '/publications', title: 'Publications', audience: 'everyone' },
  dividends: { path: '/dividends', title: 'Dividends', audience: 'everyone' },
  company: { path: '/company', title: 'Company', subtitle: 'Manage your company profile', audience: 'company' },
  companyListing: {
    path: '/company/listing',
    title: 'Listing Application',
    subtitle: 'Upload documents and submit for review',
    audience: 'company',
  },
  companyOffering: { path: '/company/offering', title: 'Offering', audience: 'company' },
  userProfile: { path: '/user-profile', title: 'Profile', subtitle: 'Manage your account', audience: 'everyone' },
  settings: { path: '/settings', title: 'Settings', subtitle: 'Configure your preferences', audience: 'everyone' },
} as const satisfies Record<string, Destination>;

export type DestinationKey = keyof typeof DESTINATIONS;

const AUDIENCES_OF: Record<AccountRole, readonly Audience[]> = {
  investor: ['everyone', 'investing'],
  company: ['everyone', 'company'],
  both: ['everyone', 'investing', 'company'],
};

export function canOpen(role: AccountRole, audience: Audience): boolean {
  return AUDIENCES_OF[role].includes(audience);
}

export function landingFor(role: AccountRole): string {
  return role === 'investor' ? DESTINATIONS.home.path : DESTINATIONS.company.path;
}
