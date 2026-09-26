import type { AccountRole } from '../../types/domain/user-preferences';

export type Audience = 'everyone' | 'investing' | 'company';

export interface Destination {
  path: string;
  title: string;
  audience: Audience;
}

export const DESTINATIONS = {
  home: { path: '/home', title: 'Holdings', audience: 'everyone' },
  wallets: { path: '/wallets', title: 'Wallets', audience: 'everyone' },
  transactions: { path: '/transactions', title: 'Activity', audience: 'everyone' },
  trading: { path: '/trading', title: 'Market', audience: 'investing' },
  directory: { path: '/directory', title: 'Directory', audience: 'investing' },
  directoryDetail: { path: '/directory/:uuid', title: 'Directory', audience: 'investing' },
  subscriptions: { path: '/subscriptions', title: 'Applications', audience: 'investing' },
  subscriptionDetail: { path: '/subscriptions/:uuid', title: 'Application', audience: 'investing' },
  investorEligibility: { path: '/investor-eligibility', title: 'Verification', audience: 'investing' },
  publications: { path: '/publications', title: 'Notices', audience: 'everyone' },
  dividends: { path: '/dividends', title: 'Dividends', audience: 'everyone' },
  company: { path: '/company', title: 'Company', audience: 'company' },
  companyListing: { path: '/company/listing', title: 'Application', audience: 'company' },
  companyOffering: { path: '/company/offering', title: 'Offerings', audience: 'company' },
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
