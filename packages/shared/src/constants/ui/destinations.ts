import type { AccountRole } from '../../types/domain/user-preferences';

export type Audience = 'everyone' | 'investing' | 'company';

export interface Destination {
  path: string;
  title: string;
  audience: Audience;
  views?: Record<string, string>;
  tasks?: Record<string, string>;
}

export const DESTINATIONS = {
  memberRecords: { path: '/member-records', title: 'My shares', audience: 'everyone' },
  home: { path: '/home', title: 'My shares', audience: 'everyone', views: { documents: 'Documents' } },
  walletHoldings: { path: '/wallets/holdings', title: 'Wallet shares', audience: 'everyone' },
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
  companyClass: { path: '/company/ledger/:uuid', title: 'Share class', audience: 'everyone' },
  companyRegister: {
    path: '/company/ledger',
    title: 'Ledger',
    audience: 'everyone',
    views: { shareholders: 'Shareholders', awards: 'Employee share scheme', documents: 'Documents' },
    tasks: { issue: 'Issue shares', transfer: 'Transfer shares', history: 'History', corrections: 'Corrections' },
  },
  companyRegisterSetup: { path: '/company/ledger/setup', title: 'Set up your ledger', audience: 'everyone' },
  companyRegisterImport: {
    path: '/company/ledger/:uuid/import',
    title: 'Set up your ledger',
    audience: 'everyone',
  },
  companyRegisterCorrection: {
    path: '/company/ledger/:uuid/correct/:entry',
    title: 'Correction',
    audience: 'everyone',
  },
  companyRegisterLinks: {
    path: '/company/ledger/companies/:company/links',
    title: 'Wallet links',
    audience: 'everyone',
  },
  companyRegisterTransfer: {
    path: '/company/ledger/:uuid/transfer',
    title: 'Non-paid transfer',
    audience: 'everyone',
  },
  companyRegisterOpening: { path: '/company/ledger/:uuid/open', title: 'Ledger opening', audience: 'everyone' },
  companyRegisterParticulars: {
    path: '/company/ledger/members/:member/particulars',
    title: 'Particulars change',
    audience: 'everyone',
  },
  companyShareholder: { path: '/company/ledger/members/:member', title: 'Shareholder', audience: 'everyone' },
  companyRegisterAward: { path: '/company/ledger/:uuid/awards/:award', title: 'Employee award', audience: 'everyone' },
  company: { path: '/company', title: 'Company', audience: 'everyone' },
  companyAuthority: { path: '/company/authority', title: 'Representative authority', audience: 'company' },
  companyAuthorityRequest: {
    path: '/company/authority/requests/:uuid',
    title: 'Authority request',
    audience: 'company',
  },
  companyTeam: { path: '/company/team', title: 'Company team', audience: 'everyone' },
  companyEligibility: { path: '/company/eligibility', title: 'Company eligibility', audience: 'everyone' },
  companyListing: { path: '/company/listing', title: 'Activation', audience: 'everyone' },
  companyPublications: { path: '/company/publications', title: 'Published to your members', audience: 'company' },
  companyOffering: { path: '/company/offering', title: 'Offerings', audience: 'company' },
  userProfile: { path: '/user-profile', title: 'Profile', audience: 'everyone' },
  settings: { path: '/settings', title: 'Settings', audience: 'everyone' },
} as const satisfies Record<string, Destination>;

export type DestinationKey = keyof typeof DESTINATIONS;

export type LedgerTask = keyof typeof DESTINATIONS.companyRegister.tasks;

export interface DestinationParent {
  destination: DestinationKey;
  view?: string;
  back?: false;
}

export const DESTINATION_PARENTS: Partial<Record<DestinationKey, DestinationParent>> = {
  memberRecords: { destination: 'home', back: false },
  walletHoldings: { destination: 'wallets' },
  directoryDetail: { destination: 'directory' },
  subscriptionDetail: { destination: 'subscriptions' },
  eligibilityRequests: { destination: 'investorEligibility' },
  companyClass: { destination: 'companyRegister' },
  companyRegisterSetup: { destination: 'companyRegister', back: false },
  companyRegisterImport: { destination: 'companyRegister', back: false },
  companyRegisterCorrection: { destination: 'companyRegister' },
  companyRegisterLinks: { destination: 'companyRegister' },
  companyRegisterTransfer: { destination: 'companyRegister' },
  companyRegisterOpening: { destination: 'companyRegister' },
  companyRegisterParticulars: { destination: 'companyRegister', view: 'shareholders' },
  companyShareholder: { destination: 'companyRegister', view: 'shareholders' },
  companyRegisterAward: { destination: 'companyRegister', view: 'awards' },
  company: { destination: 'settings' },
  companyAuthority: { destination: 'company' },
  companyTeam: { destination: 'settings' },
  companyEligibility: { destination: 'company' },
  companyListing: { destination: 'settings' },
  companyPublications: { destination: 'company' },
  userProfile: { destination: 'settings' },
};

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
