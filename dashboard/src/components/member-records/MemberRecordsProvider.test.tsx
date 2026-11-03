// @vitest-environment jsdom

import { TestRouter } from '../../testSupport/TestRouter';

import { PageTitle } from '@components/PageTitle';
import { MemberRecordsProvider } from './MemberRecordsProvider';
import { CompanyContextProvider } from '@components/CompanyContextProvider';
import { LedgerNavigationProvider } from '@components/LedgerNavigationProvider';
import { useCompanyContext } from '@hooks/useCompanyContext';
import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  COMPANY_ENDPOINTS,
  COMPANY_TOKEN_ENDPOINTS as URLS,
  ownMemberRecordsKey,
  USER_PREFERENCES_QUERY_KEY,
  DESTINATIONS,
} from '@ledova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AxiosInstance } from 'axios';
import { Link, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MemberRecordsPage from '@pages/home';
import CertificatesPage from '@pages/documents/certificates';
import { choose, MEMBER_ENTRY, MEMBER_RECORD } from '../../testSupport/company';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));

let client: QueryClient;

function MemberNavigation() {
  const context = useCompanyContext();
  return (
    <>
      <Link to={context!.companyPath(DESTINATIONS.certificates.path)}>Test Documents navigation</Link>
      <Link
        to={context!.companyPath('/home')}
        onClick={(event) => {
          event.preventDefault();
          context!.openDashboard();
        }}
      >
        Test Dashboard navigation
      </Link>
    </>
  );
}

async function ownShares(quantity: string) {
  await waitFor(() => expect(screen.getByText('Your issued shares').nextElementSibling?.textContent).toBe(quantity));
}

async function certificateRecords() {
  const records = await screen.findByRole('list', { name: 'Certificate records' });
  await within(records).findByText(MEMBER_RECORD.name);
  return records;
}

async function openCompanySwitch() {
  const toggle = await screen.findByRole('button', { name: 'Switch company' });
  expect(toggle.closest('header')).toBeTruthy();
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
  return screen.getByRole('combobox', { name: 'Your companies' }) as HTMLInputElement;
}

async function chooseMemberCompany(name: string) {
  const documents = !!screen.queryByRole('heading', { name: 'Certificates', level: 1 });
  fireEvent.click(screen.getByRole('link', { name: 'Test Dashboard navigation' }));
  await openCompanySwitch();
  await choose('Your companies', name);
  if (documents) fireEvent.click(screen.getByRole('link', { name: 'Test Documents navigation' }));
}

beforeEach(() => {
  api.get.mockReset();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchInterval: false },
    },
  });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('updates ownership and member workflows after invalidation without idle refreshes or losing revoked-record guards', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const preferences = { userProfile: 'profile-one', userAccount: { uuid: 'account-one', role: 'investor' } };
  let currentPreferences = preferences;
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: preferences });
  let refused = false;
  let detailRefused = false;
  let includeOther = false;
  let record: typeof MEMBER_RECORD = { ...MEMBER_RECORD, classes: [] };
  const otherRecordWithShares = {
    ...MEMBER_RECORD,
    uuid: 'abababab-abab-4bab-8bab-abababababab',
    member: 'babababa-baba-4aba-8aba-babababababa',
    company: { ...MEMBER_RECORD.company, uuid: 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd', name: 'Second Demo Company' },
    classes: [{ ...MEMBER_RECORD.classes[0], uuid: 'dededede-dede-4ede-8ede-dededededede', shares: '25' }],
    awards: [],
  };
  let otherRecord = otherRecordWithShares;
  const refreshRead = async () => {
    const previous = api.get.mock.calls.filter(([url]) => url === URLS.MEMBER_RECORDS).length;
    await act(async () => {
      const key = ownMemberRecordsKey({ userUuid: 'profile-one', ownerAccountUuid: 'account-one' });
      await client.invalidateQueries({ queryKey: key, exact: true });
      await client.invalidateQueries({ queryKey: key, predicate: (query) => query.queryKey.length === key.length + 1 });
      await client.invalidateQueries({ queryKey: key, predicate: (query) => query.queryKey.length > key.length + 1 });
    });
    expect(api.get.mock.calls.filter(([url]) => url === URLS.MEMBER_RECORDS).length).toBeGreaterThan(previous);
    await waitFor(() => expect(client.isFetching()).toBe(0));
  };
  api.get.mockImplementation(async (url: string) => {
    if (url === '/api/user-preferences/') return { data: currentPreferences };
    if (url === COMPANY_ENDPOINTS.BASE || url === '/api/v1/company-authority/appointments/')
      return { data: { results: [], next: null, count: 0 } };
    if (url === URLS.MEMBER_RECORDS) {
      if (currentPreferences.userAccount.uuid !== preferences.userAccount.uuid)
        return { data: { results: [], next: null, count: 0 } };
      if (refused) throw Object.assign(new Error('Current association revoked'), { response: { status: 404 } });
      return {
        data: { results: includeOther ? [record, otherRecord] : [record], next: null, count: includeOther ? 2 : 1 },
      };
    }
    if (url === URLS.MEMBER_RECORD(MEMBER_RECORD.uuid)) {
      if (detailRefused) throw Object.assign(new Error('Selected record unavailable'), { response: { status: 500 } });
      return { data: record };
    }
    if (url === URLS.MEMBER_RECORD(otherRecord.uuid)) {
      if (!includeOther) throw Object.assign(new Error('Association revoked'), { response: { status: 404 } });
      return { data: otherRecord };
    }
    if (url === URLS.MEMBER_ENTRIES(MEMBER_RECORD.uuid)) return { data: { entries: [MEMBER_ENTRY] } };
    if (url === URLS.MEMBER_ENTRIES(otherRecord.uuid)) return { data: { entries: [{ ...MEMBER_ENTRY, delta: '25' }] } };
    throw new Error(`Unexpected request: ${url}`);
  });
  const view = render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api as unknown as AxiosInstance}>
        <TestRouter initialEntries={['/home#documents']}>
          <MemberRecordsProvider>
            <LedgerNavigationProvider>
              <CompanyContextProvider>
                <PageTitle.Provider value="My shares">
                  <MemberNavigation />
                  <Routes>
                    <Route path="/home" element={<MemberRecordsPage />} />
                    <Route path={DESTINATIONS.certificates.path} element={<CertificatesPage />} />
                  </Routes>
                </PageTitle.Provider>
              </CompanyContextProvider>
            </LedgerNavigationProvider>
          </MemberRecordsProvider>
        </TestRouter>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  await screen.findByText('No register entries yet.');
  const activeReads = api.get.mock.calls.length;
  await act(async () => {
    fireEvent(window, new Event('focus'));
    fireEvent(window, new Event('online'));
    fireEvent(document, new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(60_000);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
  expect(api.get.mock.calls).toHaveLength(activeReads);
  await waitFor(() => expect(client.isFetching()).toBe(0));
  record = MEMBER_RECORD;
  await refreshRead();
  await certificateRecords();
  expect(screen.queryByRole('button', { name: 'Ordinary · ORD' })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Test Dashboard navigation' }));
  await ownShares('10');
  expect(screen.queryByRole('button', { name: 'Switch company' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Your companies' })).toBeNull();
  expect(screen.getByRole('img', { name: /3 unvested, 2 vested, awaiting issue, 0 issued from award/ })).toBeTruthy();
  const awardsCard = screen.getByRole('heading', { name: 'Your employee awards' }).closest('section')!;
  expect(within(awardsCard).getByText('5 shares promised')).toBeTruthy();
  expect(
    within(awardsCard)
      .getAllByRole('term')
      .map((item) => item.textContent),
  ).toEqual(['Unvested', 'Vested, awaiting issue']);
  expect(screen.queryByRole('button', { name: 'Read own entries for Ordinary' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Accept another member invitation' })).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Member invitation code' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Refresh member records' })).toBeNull();
  expect(screen.queryByText(MEMBER_RECORD.name)).toBeNull();
  expect(screen.queryByText(MEMBER_RECORD.residentialAddress)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Share history' })).toBeNull();
  expect(screen.queryByRole('button', { name: `Open ${MEMBER_RECORD.company.name} member record` })).toBeNull();
  expect(screen.queryByText('Recent changes · Ordinary')).toBeNull();
  expect(screen.queryByRole('list', { name: 'Certificate records' })).toBeNull();
  record = {
    ...MEMBER_RECORD,
    classes: [{ ...MEMBER_RECORD.classes[0], shares: '15' }],
    awards: [
      {
        ...MEMBER_RECORD.awards[0],
        vestedShares: '5',
        vestings: [{ ...MEMBER_RECORD.awards[0].vestings[0], shares: '5' }],
        issuedShares: '5',
        availableShares: '0',
        unvestedRemainingShares: '0',
        remainingUnissuedShares: '0',
      },
    ],
  };
  await waitFor(() => expect(client.isFetching()).toBe(0));
  const beforeHidden = api.get.mock.calls.filter(([url]) => url === URLS.MEMBER_RECORDS).length;
  const visibility = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  fireEvent(document, new Event('visibilitychange'));
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(api.get.mock.calls.filter(([url]) => url === URLS.MEMBER_RECORDS)).toHaveLength(beforeHidden);
  visibility.mockReturnValue(false);
  fireEvent(document, new Event('visibilitychange'));
  expect(api.get.mock.calls.filter(([url]) => url === URLS.MEMBER_RECORDS)).toHaveLength(beforeHidden);
  await refreshRead();
  await ownShares('15');
  expect(screen.getByRole('img', { name: /0 unvested, 0 vested, awaiting issue, 5 issued from award/ })).toBeTruthy();
  const issuedAwardCard = screen.getByRole('heading', { name: 'Your employee awards' }).closest('section')!;
  expect(
    within(issuedAwardCard)
      .getAllByRole('term')
      .map((item) => item.textContent),
  ).toEqual(['Issued from award']);
  expect(screen.getByText('Your issued shares').nextElementSibling?.textContent).not.toBe('20');
  record = {
    ...record,
    awards: [
      {
        ...MEMBER_RECORD.awards[0],
        vestedShares: '3',
        issuedShares: '1',
        availableShares: '1',
        endedUnvestedShares: '1',
        endedVestedShares: '1',
        unvestedRemainingShares: '1',
        remainingUnissuedShares: '2',
        vestings: [{ ...MEMBER_RECORD.awards[0].vestings[0], shares: '4' }],
        ends: [
          {
            uuid: 'own-end',
            unvestedShares: '1',
            vestedShares: '1',
            companyEventOn: '2026-10-03',
            reason: 'Company selected reduction',
            createdAt: '2026-10-05T00:00:00Z',
          },
        ],
        vestingReversals: [
          {
            uuid: 'own-reversal',
            vesting: MEMBER_RECORD.awards[0].vestings[0].uuid,
            reversedShares: '1',
            companyEventOn: '2026-10-04',
            reason: 'Correct recorded quantity',
            createdAt: '2026-10-05T00:00:00Z',
          },
        ],
      },
    ],
  };
  await refreshRead();
  await screen.findByRole('img', {
    name: /1 unvested, 1 vested, awaiting issue, 1 issued from award, 1 unvested rights ended, 1 vested rights ended/,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Show award details' }));
  expect(screen.getByText(/Company selected reduction/)).toBeTruthy();
  expect(screen.getByText(/Correct recorded quantity/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Download.*(entitlement|correction)/ })).toBeNull();
  record = { ...MEMBER_RECORD, classes: [] };
  await refreshRead();
  expect(await screen.findByText('No issued shares yet.')).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(screen.getByRole('img', { name: /3 unvested, 2 vested, awaiting issue, 0 issued from award/ })).toBeTruthy();
  record = {
    ...record,
    awards: [{ ...MEMBER_RECORD.awards[0], vestedShares: '6', availableShares: '6' }],
  };
  await refreshRead();
  await screen.findByText('Your ownership records could not be loaded.');
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.queryByText('No issued shares yet.')).toBeNull();
  record = {
    ...record,
    awards: [{ ...MEMBER_RECORD.awards[0], shares: '0', vestedShares: '0', availableShares: '0' }],
  };
  await refreshRead();
  await screen.findByText('Your ownership records could not be loaded.');
  expect(screen.queryByRole('img')).toBeNull();
  record = MEMBER_RECORD;
  await refreshRead();
  await ownShares('10');
  await act(async () => {
    await client.refetchQueries({ queryKey: USER_PREFERENCES_QUERY_KEY, exact: true });
  });
  await refreshRead();
  await ownShares('10');
  expect(api.get.mock.calls.some(([url]) => url === URLS.HOLDERS(MEMBER_RECORD.classes[0].uuid))).toBe(false);
  fireEvent.click(screen.getByRole('link', { name: 'Test Documents navigation' }));
  expect(await screen.findByRole('heading', { name: 'Certificates', level: 1 })).toBeTruthy();
  expect(screen.queryByText('Your issued shares')).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
  expect(await certificateRecords()).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: 'Test Dashboard navigation' }));
  await ownShares('10');
  expect(screen.getByRole('list', { name: 'Share classes' })).toBeTruthy();
  await waitFor(() => expect(client.isFetching()).toBe(0));
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const beforeOffline = api.get.mock.calls.filter(([url]) => url === URLS.MEMBER_RECORDS).length;
  refused = true;
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(api.get.mock.calls.filter(([url]) => url === URLS.MEMBER_RECORDS)).toHaveLength(beforeOffline);
  online.mockReturnValue(true);
  fireEvent(window, new Event('online'));
  await refreshRead();
  await screen.findByText('Your ownership records could not be loaded.');
  await waitFor(() => expect(screen.queryByText('Your issued shares')).toBeNull());
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.queryByRole('list', { name: 'Certificate records' })).toBeNull();
  expect(screen.getByText('Your ownership records could not be loaded.')).toBeTruthy();
  expect(screen.queryByText(/No company relationships yet/)).toBeNull();
  expect(screen.queryByText('No issued shares yet.')).toBeNull();
  refused = false;
  fireEvent.click(
    screen.getByRole('button', { name: 'Try again', description: 'Your ownership records could not be loaded.' }),
  );
  await ownShares('10');
  expect(screen.getByRole('list', { name: 'Share classes' })).toBeTruthy();
  includeOther = true;
  otherRecord = { ...otherRecordWithShares, classes: [] };
  await refreshRead();
  expect((await openCompanySwitch()).disabled).toBe(false);
  fireEvent.click(screen.getByRole('link', { name: 'Test Documents navigation' }));
  await chooseMemberCompany(otherRecord.company.name);
  await screen.findByText('No register entries yet.');
  await chooseMemberCompany(MEMBER_RECORD.company.name);
  await certificateRecords();
  fireEvent.click(screen.getByRole('link', { name: 'Test Dashboard navigation' }));
  otherRecord = otherRecordWithShares;
  await refreshRead();
  detailRefused = true;
  await refreshRead();
  await screen.findByText('Your ownership records could not be loaded.');
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.queryByText('Your issued shares')).toBeNull();
  expect(screen.queryByRole('list', { name: 'Certificate records' })).toBeNull();
  expect((await openCompanySwitch()).disabled).toBe(false);
  await choose('Your companies', otherRecord.company.name);
  await ownShares('25');
  expect(screen.getByRole('heading', { name: 'Ownership overview' })).toBeTruthy();
  expect(screen.getByRole('list', { name: 'Share classes' })).toBeTruthy();
  expect(screen.getByText('Your issued shares').nextElementSibling?.textContent).not.toBe('10');
  expect(screen.queryByRole('alert')).toBeNull();
  await waitFor(() => expect(client.isFetching()).toBe(0));
  includeOther = false;
  currentPreferences = {
    userProfile: 'profile-two',
    userAccount: { uuid: 'account-two', role: 'investor' },
  };
  await act(async () => client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: currentPreferences }));
  await screen.findByText(/No company relationships yet/);
  expect(screen.queryByText('Your issued shares')).toBeNull();
  detailRefused = false;
  currentPreferences = preferences;
  await act(async () => client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: preferences }));
  await refreshRead();
  fireEvent.click(screen.getByRole('link', { name: 'Test Dashboard navigation' }));
  await ownShares('10');
  await waitFor(() => expect(client.isFetching()).toBe(0));
  view.unmount();
  const beforeUnmounted = api.get.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(api.get.mock.calls).toHaveLength(beforeUnmounted);
});
