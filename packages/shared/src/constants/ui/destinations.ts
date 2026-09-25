import type { AccountRole } from '../../types/domain/user-preferences';

export interface Destination {
  path: string;
  title: string;
  subtitle?: string;
}

export const DESTINATIONS = {
  home: { path: '/home', title: 'Home', subtitle: 'Overview of your portfolio' },
  wallets: { path: '/wallets', title: 'Wallets', subtitle: 'Manage your digital asset wallets' },
  transactions: { path: '/transactions', title: 'Transactions', subtitle: 'View your transaction history' },
  assetPrices: { path: '/asset-prices', title: 'Market', subtitle: 'Browse asset prices' },
  trading: { path: '/trading', title: 'Trading', subtitle: 'Buy and sell assets' },
  directory: { path: '/directory', title: 'Directory' },
  directoryDetail: { path: '/directory/:uuid', title: 'Directory' },
  subscriptions: { path: '/subscriptions', title: 'Subscriptions' },
  subscriptionDetail: { path: '/subscriptions/:uuid', title: 'Subscription' },
  investorEligibility: {
    path: '/investor-eligibility',
    title: 'Eligibility',
    subtitle: 'Evidence your wholesale investor status',
  },
  publications: { path: '/publications', title: 'Publications' },
  dividends: { path: '/dividends', title: 'Dividends' },
  company: { path: '/company', title: 'Company', subtitle: 'Manage your company profile' },
  companyListing: {
    path: '/company/listing',
    title: 'Listing Application',
    subtitle: 'Upload documents and submit for review',
  },
  companyOffering: { path: '/company/offering', title: 'Offering' },
  userProfile: { path: '/user-profile', title: 'Profile', subtitle: 'Manage your account' },
  settings: { path: '/settings', title: 'Settings', subtitle: 'Configure your preferences' },
} as const satisfies Record<string, Destination>;

export type DestinationKey = keyof typeof DESTINATIONS;

export function landingFor(role: AccountRole): string {
  return role === 'investor' ? DESTINATIONS.home.path : DESTINATIONS.company.path;
}
