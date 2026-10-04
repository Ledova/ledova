import { QueryClient } from '@tanstack/react-query';
import { AUTH_QUERY_KEY, USER_PREFERENCES_QUERY_KEY, type Company, type UserPreferences } from '@ledova/shared';
type AccountRole = NonNullable<UserPreferences['userAccount']>['role'];

export function companyPreferences(role: AccountRole = 'company', suffix = 'a'): UserPreferences {
  return {
    uuid: `preferences-${suffix}`,
    userProfile: `profile-${suffix}`,
    transactionAlerts: true,
    userAccount: {
      uuid: `account-${suffix}`,
      accountNumber: 'SYNTHETIC-001',
      accountType: 'individual',
      activationDate: null,
      role,
    },
  };
}

export function companyQueryClient(role: AccountRole = 'company') {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: companyPreferences(role) });
  return client;
}

export function companyDetail(overrides: Partial<Company> = {}): Company {
  return {
    uuid: 'company-a',
    name: 'Synthetic Company',
    displayName: 'Synthetic Company',
    status: 'draft',
    statusDisplay: 'Draft',
    acn: '000000019',
    abn: '',
    email: 'synthetic@example.test',
    phone: '01000',
    companyType: 'pty',
    companyTypeDisplay: 'Proprietary',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postcode: '',
    country: 'AU',
    documents: [],
    activation: null,
    createdAt: '2026-10-04T00:00:00Z',
    updatedAt: '2026-10-04T00:00:00Z',
    primaryContact: null,
    operatorWallet: '',
    isActive: false,
    isApproved: false,
    isPendingReview: false,
    canIssueTokens: false,
    isOpenToInvestors: false,
    submittedAt: null,
    reviewStartedAt: null,
    infoRequestedAt: null,
    approvedAt: null,
    activatedAt: null,
    rejectionAt: null,
    withdrawnAt: null,
    additionalInfoResponse: '',
    infoRequestReason: '',
    rejectionReason: '',
    withdrawalReason: '',
    isOwner: true,
    administrativeAccess: { capabilities: ['admin'], draftSetup: false },
    ...overrides,
  };
}
