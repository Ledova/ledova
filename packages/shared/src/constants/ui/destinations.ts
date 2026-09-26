import type { AccountRole } from '../../types/domain/user-preferences';

export type Audience = 'everyone' | 'investing' | 'company';

export interface Destination {
  path: string;
  title: string;
  audience: Audience;
}

export const DESTINATIONS = {
  home: { path: '/home', title: 'Home', audience: 'everyone' },
  wallets: { path: '/wallets', title: 'Wallets', audience: 'everyone' },
  transactions: { path: '/transactions', title: 'Transactions', audience: 'everyone' },
  trading: { path: '/trading', title: 'Trading', audience: 'investing' },
  directory: { path: '/directory', title: 'Directory', audience: 'investing' },
  directoryDetail: { path: '/directory/:uuid', title: 'Directory', audience: 'investing' },
  subscriptions: { path: '/subscriptions', title: 'Subscriptions', audience: 'investing' },
  subscriptionDetail: { path: '/subscriptions/:uuid', title: 'Subscription', audience: 'investing' },
  investorEligibility: { path: '/investor-eligibility', title: 'Eligibility', audience: 'investing' },
  publications: { path: '/publications', title: 'Publications', audience: 'everyone' },
  dividends: { path: '/dividends', title: 'Dividends', audience: 'everyone' },
  company: { path: '/company', title: 'Company', audience: 'company' },
  companyListing: { path: '/company/listing', title: 'Listing Application', audience: 'company' },
  companyOffering: { path: '/company/offering', title: 'Offering', audience: 'company' },
  userProfile: { path: '/user-profile', title: 'Profile', audience: 'everyone' },
  settings: { path: '/settings', title: 'Settings', audience: 'everyone' },
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
