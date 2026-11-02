// @vitest-environment jsdom

import { TestRouter } from '../../testSupport/TestRouter';

import { registerKey } from '@hooks/useRegisterAccess';
import { MemberRecordsProvider } from '@components/member-records/MemberRecordsProvider';
import { CompanyContextProvider } from '@components/CompanyContextProvider';
import { LedgerNavigationProvider } from '@components/LedgerNavigationProvider';
import { useCompanyContext } from '@hooks/useCompanyContext';
import { CompanyRecordedDetails } from '@pages/settings/CompanyRecordedDetails';

import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  COMPANY_ENDPOINTS,
  OWN_APPOINTMENTS_QUERY_KEY,
  COMPANY_TOKEN_ENDPOINTS as URLS,
  USER_PREFERENCES_QUERY_KEY,
  type TokenHoldersResponse,
  type OwnMemberRecord,
  DESTINATIONS,
} from '@ledova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AxiosInstance } from 'axios';
import { Link, Route, Routes } from 'react-router-dom';
import { webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { MEMBER_CODE, MEMBER_ENTRY, MEMBER_RECORD, choose, showAllClasses } from '../../testSupport/company';
import { AWARD_REQUEST, REGISTER, awardFrom } from '../../testSupport/company';
import { OUTPUT_APPOINTMENT } from '../../testSupport/company';
import MemberRecordsPage from './index';
import CertificatesPage from '../documents/certificates';
import MemberInvitationPage from '../member-invitation';
import { CompanyMemberAccess } from '../company/ledger/CompanyMemberAccess';
import { Page } from '@components/Page';

function MemberPageLinks() {
  const context = useCompanyContext();
  return (
    <nav>
      <Link to={context!.companyPath('/home')}>Dashboard</Link>
      <Link to={context!.companyPath('/home#documents')}>Documents</Link>
      <Link to={context!.companyPath('/settings#profile')}>Settings</Link>
      <Link to="/home?company=unavailable-company">Open unavailable company</Link>
    </nav>
  );
}

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
let release: (() => void) | undefined;
afterEach(async () => {
  await act(async () => release?.());
  release = undefined;
  cleanup();
  client.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const page = (results: unknown[]) => ({ data: { results, next: null, count: results.length } });
const memberRegister: TokenHoldersResponse = {
  ...REGISTER,
  token: { ...REGISTER.token, uuid: MEMBER_RECORD.classes[0].uuid },
  issuedSupply: '10',
  totalHolders: 1,
  holders: [
    {
      member: MEMBER_RECORD.member,
      name: MEMBER_RECORD.name,
      holderType: 'member',
      balance: '10',
      shareClass: 'Ordinary',
      source: 'register',
      identitySource: 'company_recorded',
      enteredOn: '2026-10-01',
      percentage: 100,
      wallets: [],
    },
  ],
};

it('invites and associates a walletless member, recovers one exact request and refuses cached records after current read loss', async () => {
  const preferences = { userProfile: 'profile-one', userAccount: { uuid: 'account-one', role: 'investor' } };
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: preferences });
  let associated = false;
  let currentMemberRecord: OwnMemberRecord = MEMBER_RECORD;
  let additionalRecords: OwnMemberRecord[] = [];
  let holdMemberRecord = false;
  let refused = false;
  let preferencesRefused = false;
  vi.stubGlobal('crypto', { randomUUID: () => webcrypto.randomUUID() });
  let invitation: unknown;
  let mailAttempts = 0;
  let holdPreview = true;
  let signupCompleted = false;
  api.get.mockReset().mockImplementation(async (url) => {
    if (url === '/api/user-preferences/') {
      if (preferencesRefused)
        throw Object.assign(new Error('Current preferences refused'), { response: { status: 404 } });
      return { data: preferences };
    }
    if (url === '/api/user-profiles/') {
      const current = client.getQueryData<{ data: typeof preferences }>(USER_PREFERENCES_QUERY_KEY)?.data;
      return page([{ uuid: current?.userProfile, isSignupCompleted: signupCompleted }]);
    }
    if (url === COMPANY_ENDPOINTS.BASE) return page([]);
    if (url === '/api/v1/company-authority/appointments/')
      return page(associated ? [] : [{ ...OUTPUT_APPOINTMENT, capabilities: ['admin', 'prepare'] }]);
    if (url === URLS.MEMBER_INVITATIONS) return page(invitation ? [invitation] : []);
    if (url === URLS.REGISTER_AWARDS) return page([]);
    if (url === URLS.MEMBER_ASSOCIATIONS) return page([]);
    if (url === URLS.MEMBER_RECORDS) {
      if (refused) throw Object.assign(new Error('Current member access refused'), { response: { status: 404 } });
      const current = client.getQueryData<{ data: typeof preferences }>(USER_PREFERENCES_QUERY_KEY)?.data;
      return page(
        associated &&
          current?.userProfile === preferences.userProfile &&
          current.userAccount.uuid === preferences.userAccount.uuid
          ? [currentMemberRecord, ...additionalRecords]
          : [],
      );
    }
    if (url === URLS.MEMBER_RECORD(MEMBER_RECORD.uuid)) {
      const response = { data: currentMemberRecord };
      if (holdMemberRecord) {
        holdMemberRecord = false;
        return new Promise((resolve) => {
          release = () => resolve(response);
        });
      }
      return response;
    }
    const additional = additionalRecords.find((record) => url === URLS.MEMBER_RECORD(record.uuid));
    if (additional) return { data: additional };
    if (url === URLS.MEMBER_ENTRIES(MEMBER_RECORD.uuid)) return { data: { entries: [MEMBER_ENTRY] } };
    if (additionalRecords.some((record) => url === URLS.MEMBER_ENTRIES(record.uuid))) return { data: { entries: [] } };
    throw new Error(`Unexpected GET ${url}`);
  });
  api.post.mockReset().mockImplementation(async (url, body) => {
    if (url === URLS.MEMBER_INVITATION_SEND_EMAIL) {
      invitation = {
        ...body,
        uuid: body.operationId,
        status: 'pending',
        emailDelivery: 'accepted',
        acceptanceDeadline: '2026-10-18T00:00:00Z',
      };
      if (++mailAttempts === 1) throw new Error('Synthetic interrupted invitation delivery');
      return { data: invitation };
    }
    if (url === URLS.MEMBER_INVITATION_PREVIEW) {
      expect(body).toEqual({ code: MEMBER_CODE });
      if (
        client.getQueryData<{ data: typeof preferences }>(USER_PREFERENCES_QUERY_KEY)?.data.userAccount.uuid !==
        preferences.userAccount.uuid
      )
        throw Object.assign(new Error('This invitation is for another recipient.'), {
          response: { status: 403, data: { detail: 'This invitation is for another recipient.' } },
        });
      const response = {
        data: {
          company: MEMBER_RECORD.company,
          member: { uuid: MEMBER_RECORD.member, name: MEMBER_RECORD.name },
          intendedEmail: 'member@example.test',
          acceptanceDeadline: '2026-10-28T00:00:00Z',
          status: 'pending',
        },
      };
      if (holdPreview) {
        holdPreview = false;
        return new Promise((resolve) => {
          release = () => resolve(response);
        });
      }
      return response;
    }
    if (url === URLS.MEMBER_INVITATION_ACCEPT) {
      associated = true;
      return {
        data: {
          uuid: MEMBER_RECORD.uuid,
          company: MEMBER_RECORD.company.uuid,
          member: MEMBER_RECORD.member,
          userAccount: body.userAccount,
          invitation: 'invite-one',
          current: true,
        },
      };
    }
    throw new Error(`Unexpected POST ${url}`);
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api as unknown as AxiosInstance}>
        <TestRouter initialEntries={['/home']}>{children}</TestRouter>
      </ApiClientProvider>
    </QueryClientProvider>
  );
  const memberHeld = vi.fn();
  const companyView = (
    <Page>
      <CompanyMemberAccess
        owner={{ userUuid: preferences.userProfile, ownerAccountUuid: preferences.userAccount.uuid }}
        company={MEMBER_RECORD.company.uuid}
        guard={() => {}}
        registers={[memberRegister]}
        onHeldChange={memberHeld}
      />
    </Page>
  );
  const company = render(companyView, { wrapper });
  expect(screen.queryByRole('button', { name: 'Refresh member access' })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'Invite a member' }));
  await choose('Member or award recipient', 'Company Recorded Member', 'recorded member');
  fireEvent.change(screen.getByLabelText('Intended recipient email'), { target: { value: 'member@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
  await screen.findByRole('button', { name: 'Retry original company member action' });
  expect(memberHeld).toHaveBeenLastCalledWith(true);
  company.rerender(companyView);
  expect((screen.getByLabelText('Intended recipient email') as HTMLInputElement).value).toBe('member@example.test');
  fireEvent.click(screen.getByRole('button', { name: 'Retry original company member action' }));
  await screen.findByText(/The invitation email was accepted for sending/);
  const mailCommands = api.post.mock.calls.filter(([url]) => url === URLS.MEMBER_INVITATION_SEND_EMAIL);
  expect(mailCommands).toHaveLength(2);
  expect(mailCommands[0][1]).toEqual(mailCommands[1][1]);
  expect(screen.queryByLabelText('One-time member invitation code')).toBeNull();
  expect(await screen.findByText(/member@example.test/)).toBeTruthy();
  preferencesRefused = true;
  await act(async () => {
    await client.refetchQueries({ queryKey: USER_PREFERENCES_QUERY_KEY, exact: true });
  });
  await waitFor(() => expect(screen.queryByText(/member@example.test/)).toBeNull());
  expect(screen.queryByLabelText('One-time member invitation code')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Send invitation' })).toBeNull();
  preferencesRefused = false;
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: preferences });
  company.unmount();
  window.history.replaceState({}, '', `/member-invitation#${MEMBER_CODE}`);
  const recipient = render(<MemberInvitationPage />, { wrapper });
  await screen.findByRole('link', { name: 'Continue setup' });
  expect(api.post.mock.calls.filter(([url]) => url === URLS.MEMBER_INVITATION_PREVIEW)).toHaveLength(0);
  signupCompleted = true;
  await act(async () => client.refetchQueries({ queryKey: ['userProfiles'] }));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  await act(async () => {
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
      data: { userProfile: 'other-profile', userAccount: { uuid: 'other-account', role: 'investor' } },
    });
    release!();
  });
  expect(screen.queryByText(MEMBER_RECORD.name)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Accept invitation' })).toBeNull();
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ),
  ).not.toContain(MEMBER_CODE);
  await act(async () => client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: preferences }));
  await screen.findByText(MEMBER_RECORD.name);
  expect(window.location.hash).toBe('');
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(associated).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
  await waitFor(() => expect(associated).toBe(true));
  await screen.findByText(/Invitation accepted/);
  expect(sessionStorage).toHaveLength(0);
  recipient.unmount();
  await act(async () => {
    await client.refetchQueries({ queryKey: OWN_APPOINTMENTS_QUERY_KEY });
  });
  const memberPages = (
    <MemberRecordsProvider>
      <LedgerNavigationProvider>
        <CompanyContextProvider>
          <MemberPageLinks />
          <Routes>
            <Route path="/home" element={<MemberRecordsPage />} />
            <Route path={DESTINATIONS.certificates.path} element={<CertificatesPage />} />
            <Route path="/settings" element={<CompanyRecordedDetails />} />
          </Routes>
        </CompanyContextProvider>
      </LedgerNavigationProvider>
    </MemberRecordsProvider>
  );
  const memberView = render(memberPages, { wrapper });
  await screen.findByText('Your issued shares');
  expect(screen.queryByRole('button', { name: 'Switch company' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Your companies' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Company' })).toBeNull();
  expect(screen.queryByRole('group', { name: 'Ownership view' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Refresh member records' })).toBeNull();
  const shareClasses = screen.getByRole('list', { name: 'Share classes' });
  expect(within(shareClasses).getByRole('button', { name: 'Explore Ordinary (ORD)' })).toBeTruthy();
  expect(within(shareClasses).getByText('10')).toBeTruthy();
  expect(screen.queryByText(MEMBER_RECORD.name)).toBeNull();
  expect(screen.queryByText(MEMBER_RECORD.residentialAddress)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Read own entries for Ordinary' })).toBeNull();
  expect(screen.queryByText('Recent changes · Ordinary')).toBeNull();
  expect(screen.getByRole('img', { name: /3 unvested, 2 vested, awaiting issue, 0 issued from award/ })).toBeTruthy();
  expect(screen.queryByRole('list', { name: 'Certificate records' })).toBeNull();
  const ownership: NonNullable<OwnMemberRecord['ownership']> = {
    company: MEMBER_RECORD.company.uuid,
    companyName: MEMBER_RECORD.company.name,
    asAt: '2026-10-27T00:00:00Z',
    complete: true,
    issuedSupply: '1500',
    totalHolders: 3,
    classes: [
      {
        uuid: MEMBER_RECORD.classes[0].uuid,
        name: 'Ordinary',
        symbol: 'ORD',
        tokenType: 'ordinary',
        initialized: true,
        issuedSupply: '1000',
        ownShares: '10',
        totalHolders: 2,
        sequence: 1,
        recordedAt: '2026-10-27T00:00:00Z',
      },
      {
        uuid: '45454545-4545-4545-8545-454545454545',
        name: 'Preference',
        symbol: 'PRF',
        tokenType: 'preference',
        initialized: true,
        issuedSupply: '500',
        ownShares: '0',
        totalHolders: 1,
        sequence: 1,
        recordedAt: '2026-10-27T00:00:00Z',
      },
    ],
  };
  const ownDetailKey = ['member-records', 'profile-one', 'account-one', 0, MEMBER_RECORD.uuid];
  currentMemberRecord = { ...MEMBER_RECORD, ownership };
  await act(async () => client.refetchQueries({ queryKey: ownDetailKey, exact: true }));
  const companySummary = await screen.findByRole('region', { name: 'Company ownership summary' });
  expect(companySummary.textContent).toContain('1,500');
  expect(screen.queryByRole('button', { name: 'Your shares' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Company ownership' })).toBeNull();
  const preference = screen.getByRole('button', { name: 'Explore Preference (PRF)' });
  fireEvent.click(preference);
  await screen.findByRole('heading', { name: 'Preference' });
  const classDetails = screen.getByRole('heading', { name: 'Preference' }).closest('section')!;
  expect(within(classDetails).getByText('0')).toBeTruthy();
  expect(within(classDetails).getByText('0.00%')).toBeTruthy();
  fireEvent.click(within(classDetails).getByRole('button', { name: 'Filters' }));
  expect(screen.queryByRole('searchbox', { name: 'Search shareholders' })).toBeNull();
  fireEvent.change(screen.getByRole('combobox', { name: 'Share class' }), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Explore Ordinary (ORD)' }));
  const ordinaryDetails = (await screen.findByRole('heading', { name: 'Ordinary' })).closest('section')!;
  expect(within(ordinaryDetails).getByText('1.00%')).toBeTruthy();
  expect(within(ordinaryDetails).getByText('10')).toBeTruthy();
  showAllClasses();
  holdMemberRecord = true;
  release = undefined;
  let refreshing: Promise<void>;
  await act(async () => {
    refreshing = client.refetchQueries({ queryKey: ownDetailKey, exact: true });
  });
  await waitFor(() => expect(release).toBeTypeOf('function'));
  expect(screen.queryByRole('region', { name: 'Company ownership summary' })).toBeNull();
  await act(async () => {
    release!();
    await refreshing;
  });
  expect((await screen.findByRole('region', { name: 'Company ownership summary' })).textContent).toContain('1,500');
  expect(
    api.get.mock.calls.some(
      ([url]) => url === URLS.OWNERSHIP || (typeof url === 'string' && url.includes('/ownership-holders/')),
    ),
  ).toBe(false);
  currentMemberRecord = {
    ...MEMBER_RECORD,
    classes: [...MEMBER_RECORD.classes, { ...MEMBER_RECORD.classes[0], shares: '999' }],
    ownership,
  };
  await act(async () => client.refetchQueries({ queryKey: ownDetailKey, exact: true }));
  await screen.findByText('Your ownership records could not be loaded.');
  expect(screen.queryByRole('region', { name: 'Company ownership summary' })).toBeNull();
  expect(screen.queryByText('1,500')).toBeNull();
  currentMemberRecord = { ...MEMBER_RECORD, ownership: { ...ownership, company: 'foreign-company' } };
  await act(async () => client.refetchQueries({ queryKey: ownDetailKey, exact: true }));
  await screen.findByText('Your issued shares');
  expect(screen.queryByRole('region', { name: 'Company ownership summary' })).toBeNull();
  currentMemberRecord = { ...MEMBER_RECORD, ownership };
  await act(async () => client.refetchQueries({ queryKey: ownDetailKey, exact: true }));
  await screen.findByRole('region', { name: 'Company ownership summary' });
  preferencesRefused = true;
  await act(async () => client.refetchQueries({ queryKey: USER_PREFERENCES_QUERY_KEY, exact: true }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Company ownership summary' })).toBeNull());
  expect(screen.queryByText('1,500')).toBeNull();
  preferencesRefused = false;
  await act(async () => client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: preferences }));
  await screen.findByRole('region', { name: 'Company ownership summary' });
  await act(async () => {
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
      data: { userProfile: 'other-profile', userAccount: { uuid: 'other-account', role: 'investor' } },
    });
  });
  await screen.findByText(/No company relationships yet/);
  expect(screen.queryByRole('region', { name: 'Company ownership summary' })).toBeNull();
  await act(async () => client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: preferences }));
  await screen.findByRole('region', { name: 'Company ownership summary' });
  additionalRecords = [2, 3].map((number) => {
    const uuid = `${number}aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
    const member = `${number}bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;
    const company = {
      ...MEMBER_RECORD.company,
      uuid: `${number}ccccccc-cccc-4ccc-8ccc-cccccccccccc`,
      name: `Company ${number}`,
    };
    const shareClass = {
      ...MEMBER_RECORD.classes[0],
      uuid: `${number}ddddddd-dddd-4ddd-8ddd-dddddddddddd`,
      shares: `${number * 10}`,
    };
    return {
      ...MEMBER_RECORD,
      uuid,
      member,
      company,
      classes: [shareClass],
      awards: [],
      ownership: {
        ...ownership,
        company: company.uuid,
        companyName: company.name,
        issuedSupply: `${number * 1000}`,
        totalHolders: 2,
        classes: [
          {
            ...ownership.classes[0],
            uuid: shareClass.uuid,
            issuedSupply: `${number * 1000}`,
            ownShares: shareClass.shares,
          },
        ],
      },
    };
  });
  await act(async () => client.refetchQueries({ queryKey: ownDetailKey.slice(0, -1), exact: true }));
  memberView.unmount();
  render(memberPages, { wrapper });
  const switchCompany = async (name: string, search = name) => {
    const toggle = await screen.findByRole('button', { name: 'Switch company' });
    expect(toggle.closest('header')).toBeTruthy();
    expect(toggle.getAttribute('title')).toBe('Switch company');
    fireEvent.click(toggle);
    await choose('Your companies', name, search);
    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Your companies' })).toBeNull());
    expect(document.activeElement).toBe(toggle);
  };
  await screen.findByRole('button', { name: 'Switch company' });
  expect(screen.queryByRole('combobox', { name: 'Your companies' })).toBeNull();
  expect(screen.queryByRole('list', { name: 'Your companies' })).toBeNull();
  await switchCompany('Company 2', 'company 2');
  expect((await screen.findByRole('region', { name: 'Company ownership summary' })).textContent).toContain('2,000');
  expect(screen.getByRole('list', { name: 'Share classes' }).textContent).toContain('You: 20');
  expect(screen.queryByText('1,500')).toBeNull();
  await switchCompany('Company 3', 'company 3');
  expect((await screen.findByRole('region', { name: 'Company ownership summary' })).textContent).toContain('3,000');
  expect(screen.getByRole('list', { name: 'Share classes' }).textContent).toContain('You: 30');
  expect(screen.queryByText('2,000')).toBeNull();
  await switchCompany(MEMBER_RECORD.company.name);
  expect((await screen.findByRole('region', { name: 'Company ownership summary' })).textContent).toContain('1,500');
  fireEvent.click(screen.getByRole('button', { name: 'Explore Ordinary (ORD)' }));
  const selectedOrdinary = await screen.findByRole('heading', { name: 'Ordinary' });
  await waitFor(() => expect(document.activeElement).toBe(selectedOrdinary));
  expect(screen.getByRole('button', { name: 'Company ownership' })).toBeTruthy();
  await switchCompany('Company 2', 'company 2');
  expect((await screen.findByRole('region', { name: 'Company ownership summary' })).textContent).toContain('2,000');
  expect(screen.queryByRole('heading', { name: 'Ordinary' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Company ownership' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Filters' })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Switch company' }));
  await switchCompany(MEMBER_RECORD.company.name);
  expect((await screen.findByRole('region', { name: 'Company ownership summary' })).textContent).toContain('1,500');
  additionalRecords = [];
  await act(async () => client.refetchQueries({ queryKey: ownDetailKey.slice(0, -1), exact: true }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Switch company' })).toBeNull());
  expect(screen.queryByRole('combobox', { name: 'Your companies' })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Open unavailable company' }));
  await screen.findByRole('heading', { name: 'Company unavailable' });
  expect(screen.queryByRole('button', { name: 'Switch company' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Company ownership summary' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open your company' }));
  expect((await screen.findByRole('region', { name: 'Company ownership summary' })).textContent).toContain('1,500');
  currentMemberRecord = { ...MEMBER_RECORD, ownership: null };
  holdMemberRecord = true;
  release = undefined;
  await act(async () => {
    refreshing = client.refetchQueries({ queryKey: ownDetailKey, exact: true });
  });
  await waitFor(() => expect(release).toBeTypeOf('function'));
  expect(screen.queryByRole('region', { name: 'Company ownership summary' })).toBeNull();
  expect(screen.queryByText('1,500')).toBeNull();
  await act(async () => {
    release!();
    await refreshing;
  });
  await screen.findByText('Your issued shares');
  expect(screen.queryByRole('region', { name: 'Company ownership summary' })).toBeNull();
  expect(screen.queryByRole('group', { name: 'Ownership view' })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
  const detailsCard = (await screen.findByText('Wrong? Contact the company.')).closest('section')!;
  expect(
    within(detailsCard).getByRole('heading', { name: `How ${MEMBER_RECORD.company.name} records you` }),
  ).toBeTruthy();
  expect(
    within(detailsCard)
      .getAllByRole('definition')
      .map((item) => item.textContent),
  ).toEqual([MEMBER_RECORD.name, MEMBER_RECORD.residentialAddress]);
  expect(within(detailsCard).queryByRole('button')).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Documents' }));
  const certificatesCard = (await screen.findByRole('heading', { name: 'Certificate records' })).closest('section')!;
  expect(await within(certificatesCard).findByText('+10 ORD shares')).toBeTruthy();
  const certificateRow = within(certificatesCard).getByText(MEMBER_RECORD.name).closest('li')!;
  expect(within(certificateRow).getByText('Not recorded')).toBeTruthy();
  expect(within(certificatesCard).queryByRole('button')).toBeNull();
  expect(screen.queryByRole('button', { name: /^Filters/ })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Share history' })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }));
  await screen.findByText('Your issued shares');
  await waitFor(() => expect(client.isFetching()).toBe(0));
  const hiddenReads = () =>
    api.get.mock.calls.filter(([url]) => url === URLS.MEMBER_ENTRIES(MEMBER_RECORD.uuid)).length;
  const previousReads = hiddenReads();
  await act(async () => {
    await client.invalidateQueries({ queryKey: [...ownDetailKey, 'entries'] });
  });
  expect(hiddenReads()).toBe(previousReads);
  fireEvent.click(screen.getByRole('link', { name: 'Documents' }));
  const finalRecords = await screen.findByRole('list', { name: 'Certificate records' });
  expect(await within(finalRecords).findByText(MEMBER_RECORD.name)).toBeTruthy();
  refused = true;
  await act(async () => {
    await client.refetchQueries({ queryKey: ['member-records', 'profile-one', 'account-one', 0], exact: true });
  });
  await waitFor(() => expect(screen.queryByText(MEMBER_RECORD.name)).toBeNull());
  expect(screen.queryByRole('list', { name: 'Certificate records' })).toBeNull();
  expect(screen.queryByRole('img', { name: /Your issued shares by class/ })).toBeNull();
  expect(screen.queryByText(MEMBER_RECORD.residentialAddress)).toBeNull();
});

it('invites an exact award-only recipient, deduplicates members and clears unavailable and foreign company selections', async () => {
  const preferences = { userProfile: 'profile-one', userAccount: { uuid: 'account-one', role: 'company' } };
  const owner = { userUuid: preferences.userProfile, ownerAccountUuid: preferences.userAccount.uuid };
  const company = MEMBER_RECORD.company.uuid;
  const otherCompany = '99999999-9999-4999-8999-999999999999';
  const awardMember = '88888888-8888-4888-8888-888888888888';
  const otherClass = '77777777-7777-4777-8777-777777777777';
  const award = {
    ...awardFrom(AWARD_REQUEST),
    company,
    token: memberRegister.token.uuid,
    member: awardMember,
    name: 'Award Only Recipient',
    recipientName: 'Award Only Recipient',
  };
  let awards = [award];
  let invitation: unknown;
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: preferences });
  vi.stubGlobal('crypto', { randomUUID: () => webcrypto.randomUUID() });
  api.get.mockReset().mockImplementation(async (url, config) => {
    if (url === '/api/user-preferences/') return { data: preferences };
    if (url === '/api/v1/company-authority/appointments/')
      return page([
        { ...OUTPUT_APPOINTMENT, company, capabilities: ['admin'] },
        { ...OUTPUT_APPOINTMENT, company: otherCompany, capabilities: ['admin'] },
      ]);
    if (url === URLS.REGISTER_AWARDS) {
      expect([company, otherCompany]).toContain(config.params.company);
      return page(awards);
    }
    if (url === URLS.MEMBER_INVITATIONS) return page(invitation ? [invitation] : []);
    if (url === URLS.MEMBER_ASSOCIATIONS) return page([]);
    throw new Error(`Unexpected GET ${url}`);
  });
  api.post.mockReset().mockImplementation(async (url, body) => {
    expect(url).toBe(URLS.MEMBER_INVITATION_SEND_EMAIL);
    invitation = {
      ...body,
      uuid: body.operationId,
      status: 'pending',
      emailDelivery: 'accepted',
      acceptanceDeadline: '2026-10-18T00:00:00Z',
    };
    return { data: invitation };
  });
  const guard = () => {};
  const onHeldChange = vi.fn();
  const companyView = (uuid: string, registers: TokenHoldersResponse[], sourceReady = true) => (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api as unknown as AxiosInstance}>
        <TestRouter initialEntries={['/company/ledger#member-access']}>
          <Page>
            <CompanyMemberAccess
              owner={owner}
              company={uuid}
              registers={registers}
              guard={guard}
              sourceReady={sourceReady}
              onHeldChange={onHeldChange}
            />
          </Page>
        </TestRouter>
      </ApiClientProvider>
    </QueryClientProvider>
  );
  const registers = [
    memberRegister,
    { ...memberRegister, token: { ...memberRegister.token, uuid: otherClass, symbol: 'PREF' } },
  ];
  const view = render(companyView(company, registers));
  expect(screen.queryByRole('combobox', { name: 'Member or award recipient' })).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Company action reason' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Refresh member access' })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'Invite a member' }));
  const recipient = await screen.findByRole('combobox', { name: 'Member or award recipient' });
  await waitFor(() => expect((recipient as HTMLInputElement).disabled).toBe(false));
  fireEvent.change(recipient, { target: { value: ' ' } });
  const awardOnly = await screen.findByRole('option', {
    name: 'Award Only Recipient · Award recipient without shares · ORD',
  });
  expect(screen.getAllByRole('option', { name: /Company Recorded Member/ })).toHaveLength(1);
  expect(screen.queryByLabelText('Member UUID')).toBeNull();
  fireEvent.change(recipient, { target: { value: 'award only' } });
  expect(screen.queryByRole('option', { name: /Company Recorded Member/ })).toBeNull();
  fireEvent.mouseDown(awardOnly);
  fireEvent.change(screen.getByLabelText('Intended recipient email'), { target: { value: 'employee@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
  await screen.findByText(/The invitation email was accepted for sending/);
  expect(screen.queryByLabelText('One-time member invitation code')).toBeNull();
  expect(api.post).toHaveBeenCalledWith(
    URLS.MEMBER_INVITATION_SEND_EMAIL,
    expect.objectContaining({ company, member: awardMember, intendedEmail: 'employee@example.test' }),
    expect.any(Object),
  );
  expect(onHeldChange).toHaveBeenCalledWith(true);
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('combobox', { name: 'Member or award recipient' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Invite a member' }));

  awards = [];
  await act(async () =>
    client.refetchQueries({
      queryKey: [...registerKey(owner), 'invitation-awards', company],
      exact: true,
    }),
  );
  await waitFor(() =>
    expect((screen.getByRole('combobox', { name: 'Member or award recipient' }) as HTMLInputElement).value).toBe(''),
  );
  expect((screen.getByLabelText('Intended recipient email') as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
  expect(document.activeElement).toBe(screen.getByText('Before continuing:').parentElement);
  expect(screen.getByRole('combobox', { name: 'Member or award recipient' }).getAttribute('aria-invalid')).toBe('true');
  expect(api.post).toHaveBeenCalledTimes(1);

  await choose('Member or award recipient', 'Company Recorded Member', 'recorded member');
  fireEvent.change(screen.getByLabelText('Intended recipient email'), { target: { value: 'member@example.test' } });
  awards = [{ ...award, name: 'Foreign Private Award Recipient' }];
  invitation = undefined;
  view.rerender(companyView(otherCompany, [{ ...REGISTER, token: { ...REGISTER.token, uuid: otherClass } }]));
  fireEvent.click(await screen.findByRole('button', { name: 'Invite a member' }));
  await screen.findByText('The award recipients belong to another company.');
  expect((screen.getByRole('combobox', { name: 'Member or award recipient' }) as HTMLInputElement).value).toBe('');
  expect((screen.getByRole('combobox', { name: 'Member or award recipient' }) as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText('Intended recipient email') as HTMLInputElement).value).toBe('');
  expect(screen.getByRole('button', { name: 'Send invitation' }).matches(':disabled')).toBe(true);
  expect(api.post).toHaveBeenCalledTimes(1);
  view.rerender(companyView(otherCompany, [], false));
  await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Member or award recipient' })).toBeNull());
});
