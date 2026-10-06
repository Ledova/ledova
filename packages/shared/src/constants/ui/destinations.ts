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
  eligibilityRequests: { path: '/eligibility-requests', title: 'Your company eligibility', audience: 'investing' },
  publications: { path: '/publications', title: 'Notices', audience: 'everyone' },
  companyClass: { path: '/company/register/:uuid', title: 'Share class', audience: 'company' },
  companyRegister: { path: '/company/register', title: 'Register', audience: 'everyone' },
  companyRegisterImport: { path: '/company/register/:uuid/import', title: 'Register', audience: 'everyone' },
  companyRegisterCorrection: {
    path: '/company/register/:uuid/correct/:entry',
    title: 'Register',
    audience: 'everyone',
  },
  companyRegisterOpening: { path: '/company/register/:uuid/open', title: 'Register', audience: 'everyone' },
  company: { path: '/company', title: 'Company', audience: 'everyone' },
  companyAuthority: { path: '/company/authority', title: 'Representative authority', audience: 'company' },
  companyTeam: { path: '/company/team', title: 'Company team', audience: 'everyone' },
  companyEligibility: { path: '/company/eligibility', title: 'Company eligibility', audience: 'everyone' },
  companyListing: { path: '/company/listing', title: 'Activation', audience: 'everyone' },
  companyPublications: { path: '/company/publications', title: 'Published to your members', audience: 'company' },
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
  return Object.prototype.hasOwnProperty.call(AUDIENCES_OF, role)
    ? AUDIENCES_OF[role].includes(audience)
    : audience === 'everyone';
}

export function landingFor(role: AccountRole): string {
  return canOpen(role, 'company') ? DESTINATIONS.companyRegister.path : DESTINATIONS.home.path;
}
