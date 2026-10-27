import { TestRouter } from './TestRouter';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Routes } from 'react-router-dom';
import { PageTitle } from '@components/PageTitle';
import apiClient from '@services/apiClient';
import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  USER_PREFERENCES_QUERY_KEY,
  DESTINATIONS,
  type Company,
  type AccountRole,
  type UserPreferences,
} from '@ledova/shared';

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

globalThis.matchMedia ??= (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => true,
});

export async function choose(label: string, option: string, search = option) {
  const input = (await screen.findByRole('combobox', { name: label })) as HTMLInputElement;
  await waitFor(() => {
    if (input.disabled) throw new Error(`${label} is disabled`);
  });
  fireEvent.change(input, { target: { value: search } });
  fireEvent.mouseDown(await screen.findByRole('option', { name: (name) => name.startsWith(option) }));
}

export function companyPreferences(role: AccountRole = 'company'): UserPreferences {
  return {
    uuid: 'preferences-one',
    userProfile: 'profile-one',
    userAccount: {
      uuid: 'account-one',
      role,
      accountNumber: 'synthetic-one',
      accountType: 'individual',
      activationDate: null,
    },
    transactionAlerts: true,
  };
}

export function prepareCompanyClient(client: QueryClient, role: AccountRole = 'company') {
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: companyPreferences(role) });
}

export function companyRecord(overrides: Partial<Company> = {}): Company {
  return {
    uuid: 'company-one',
    isOwner: true,
    administrativeAccess: { capabilities: ['admin'], draftSetup: false },
    name: 'Harbour Example Pty Ltd',
    tradingName: 'Harbour Example',
    displayName: 'Harbour Example',
    acn: '000000019',
    abn: '53004085616',
    companyType: 'pty',
    companyTypeDisplay: 'Proprietary limited',
    status: 'draft',
    statusDisplay: 'Draft',
    email: 'company@example.invalid',
    phone: '0000000000',
    addressLine1: '1 Example Street',
    city: 'Example City',
    state: 'NSW',
    postcode: '2000',
    country: 'Australia',
    documents: [],
    activation: null,
    operatorWallet: '',
    submittedAt: null,
    reviewStartedAt: null,
    approvedAt: null,
    activatedAt: null,
    infoRequestedAt: null,
    infoRequestReason: '',
    additionalInfoResponse: '',
    rejectionAt: null,
    rejectionReason: '',
    withdrawnAt: null,
    withdrawalReason: '',
    isActive: false,
    isApproved: false,
    isPendingReview: false,
    canIssueTokens: false,
    isOpenToInvestors: false,
    shareOwnershipWithMembers: false,
    ownershipSharingChangedBy: null,
    ownershipSharingChangedAt: null,
    primaryContact: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

export function renderCompanyPage(
  client: QueryClient,
  page: ReactNode,
  title: string,
  { entry = '/', path = '/' }: { entry?: string; path?: string } = {},
) {
  if (!client.getQueryState(AUTH_QUERY_KEY)) prepareCompanyClient(client);
  return render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        <TestRouter initialEntries={[entry]}>
          <PageTitle.Provider value={title}>
            <Routes>
              <Route path={path} element={page} />
              <Route path={DESTINATIONS.company.path} element={<p>Company page</p>} />
              <Route path={DESTINATIONS.companyRegister.path} element={<p>Register page</p>} />
            </Routes>
          </PageTitle.Provider>
        </TestRouter>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

export {
  APPOINTMENT,
  AWARD_REQUEST,
  REGISTER,
  awardFrom,
  vestingFrom,
  endFrom,
  vestingReversalFrom,
} from '../../../packages/shared/tests/fixtures/employee-awards';
export {
  ALLOTMENT_REQUEST,
  allotmentFrom,
  allotmentPreview,
  allotmentDecision,
} from '../../../packages/shared/tests/fixtures/external-allotments';
export { MEMBER_RECORD, MEMBER_ENTRY, MEMBER_CODE } from '../../../packages/shared/tests/fixtures/member-access';
export {
  OUTPUT_APPOINTMENT,
  OUTPUT_REGISTER,
  OUTPUT_ENTRY,
  OUTPUT_PREVIEW,
  MEMBER_PDF,
  FULFILLED_CERTIFICATE,
} from '../../../packages/shared/tests/fixtures/register-outputs';
