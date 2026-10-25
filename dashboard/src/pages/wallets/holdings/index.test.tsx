// @vitest-environment jsdom

import { PageTitle } from '../../../components/PageTitle';
import { MemberRecordsProvider } from '@components/member-records/MemberRecordsProvider';
import { CompanyRecordedDetails } from '@pages/settings/CompanyRecordedDetails';
import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  COMPANY_TOKEN_ENDPOINTS as URLS,
  HOLDING_ASSET_TYPE,
  USER_PREFERENCES_QUERY_KEY,
  WALLET_ENDPOINTS,
  type WalletHolding,
} from '@ledova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AxiosInstance } from 'axios';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import HomePage from './index';
import MemberRecordsPage from '../../home/index';
import { choose, MEMBER_ENTRY, MEMBER_RECORD } from '../../../testSupport/company';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('./HoldingWork', () => ({ HoldingWork: () => null }));

const firstWallet = { uuid: 'wallet-one', name: 'Primary', address: `0x${'1'.repeat(40)}`, chain: 'base' };
const secondWallet = { uuid: 'wallet-two', name: 'Reserve', address: `0x${'2'.repeat(40)}`, chain: 'ethereum' };
let client: QueryClient;

function holding(overrides: Partial<WalletHolding> = {}): WalletHolding {
  return {
    uuid: 'holding-one',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    walletUuid: firstWallet.uuid,
    walletAddress: firstWallet.address,
    chain: 'base',
    assetUuid: 'asset-one',
    assetSymbol: 'ORD',
    assetName: 'Harbour Example Ordinary',
    quantity: '250.000000000000000000',
    marketValue: null,
    valueSource: 'unpriced',
    lastSyncedAt: '2026-09-01T00:00:00Z',
    shareClass: { uuid: 'class-one', name: 'Ordinary', symbol: 'ORD', companyName: 'Harbour Example Pty Ltd' },
    asset: {
      uuid: 'asset-one',
      symbol: 'ORD',
      name: 'Harbour Example Ordinary',
      assetType: HOLDING_ASSET_TYPE.TOKENIZED_SECURITY,
      assetTypeDisplay: 'Tokenized Security',
      chainDeployments: [],
      navPerToken: null,
      lastNavUpdate: null,
      isYieldToken: false,
      chain: 'base',
      contractAddress: `0x${'3'.repeat(40)}`,
      decimals: 0,
      currentPrice: null,
      valueSource: 'unpriced',
      priceCurrency: 'USD',
      isActive: true,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    },
    ...overrides,
  };
}

function page(wallets = [firstWallet], next: string | null = null) {
  return { data: { results: wallets, count: wallets.length, next, previous: null } };
}

function detailOf(row: HTMLElement) {
  const detail = document.getElementById(row.getAttribute('aria-controls') ?? '');
  expect(detail).not.toBeNull();
  return detail!;
}

function renderPage() {
  return render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api as unknown as AxiosInstance}>
        <MemoryRouter>
          <PageTitle.Provider value="Holdings">
            <HomePage />
          </PageTitle.Provider>
        </MemoryRouter>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('reads every wallet page and shows exact share totals with company/class names and hidden-class fallback', async () => {
  const share = holding({ quantity: '9007199254740993.000000000000000000' });
  const crypto = holding({
    assetUuid: 'coin',
    assetName: 'A coin',
    asset: { ...share.asset, assetType: HOLDING_ASSET_TYPE.STABLECOIN },
    quantity: '0.125',
    shareClass: null,
  });
  api.get.mockImplementation(async (url: string, config?: { params?: { page?: number } }) => {
    if (url === WALLET_ENDPOINTS.BASE) {
      return config?.params?.page === 2
        ? page([secondWallet])
        : page([firstWallet], 'https://example.test/api/wallets/?page=2');
    }
    if (url === WALLET_ENDPOINTS.HOLDINGS(firstWallet.uuid)) return { data: [share, crypto] };
    if (url === WALLET_ENDPOINTS.HOLDINGS(secondWallet.uuid)) {
      return {
        data: [
          holding({ walletUuid: secondWallet.uuid, chain: 'ethereum', quantity: '2.000000000000000000' }),
          holding({ assetUuid: 'hidden-class', assetName: 'Hidden Example Ordinary', quantity: '3', shareClass: null }),
        ],
      };
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  renderPage();

  expect(await screen.findByText('Harbour Example Pty Ltd')).toBeTruthy();
  expect(screen.getByText('9,007,199,254,740,995 shares')).toBeTruthy();
  expect(screen.getByText('Hidden Example Ordinary')).toBeTruthy();
  expect(screen.queryByText('A coin')).toBeNull();
  expect(screen.queryByText(/AUD|USD|Coin prices|Total value/)).toBeNull();
  expect(api.get).toHaveBeenCalledWith(WALLET_ENDPOINTS.BASE, { params: { page: 2 } });

  const row = screen.getByRole('button', { name: /Harbour Example Pty Ltd\s*Ordinary/ });
  fireEvent.click(row);
  expect(within(detailOf(row)).getByText('Primary')).toBeTruthy();
  expect(within(detailOf(row)).getByText('Reserve')).toBeTruthy();
});

it('updates own shares and awards automatically, preserves drafts and selected history, and hides revoked records without an empty-ownership claim', async () => {
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
  const focusRead = async () => {
    const previous = api.get.mock.calls.filter(([url]) => url === URLS.MEMBER_RECORDS).length;
    await act(async () => {
      fireEvent(window, new Event('focus'));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(api.get.mock.calls.filter(([url]) => url === URLS.MEMBER_RECORDS).length).toBeGreaterThan(previous);
    await waitFor(() => expect(client.isFetching()).toBe(0));
  };
  api.get.mockImplementation(async (url: string) => {
    if (url === '/api/user-preferences/') return { data: currentPreferences };
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
    if (url === URLS.MEMBER_RECORD(otherRecord.uuid)) return { data: otherRecord };
    if (url === URLS.MEMBER_ENTRIES(MEMBER_RECORD.uuid)) return { data: { entries: [MEMBER_ENTRY] } };
    if (url === URLS.MEMBER_ENTRIES(otherRecord.uuid)) return { data: { entries: [{ ...MEMBER_ENTRY, delta: '25' }] } };
    if (url === URLS.MEMBER_PARTICULARS_REQUESTS || url === URLS.MEMBER_CERTIFICATE_REQUESTS)
      return { data: { results: [], next: null, count: 0 } };
    throw new Error(`Unexpected request: ${url}`);
  });
  const view = render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api as unknown as AxiosInstance}>
        <MemoryRouter initialEntries={['/home#documents']}>
          <MemberRecordsProvider>
            <PageTitle.Provider value="My shares">
              <Link to="/home#documents">Test Documents navigation</Link>
              <Link to="/home">Test Dashboard navigation</Link>
              <Link to="/settings#company-recorded-details">Test Settings navigation</Link>
              <Routes>
                <Route path="/home" element={<MemberRecordsPage />} />
                <Route path="/settings" element={<CompanyRecordedDetails />} />
              </Routes>
            </PageTitle.Provider>
          </MemberRecordsProvider>
        </MemoryRouter>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  await screen.findByText('No share changes yet.');
  record = MEMBER_RECORD;
  await focusRead();
  await screen.findByRole('button', { name: 'Request certificate (Ordinary, entry 1)' });
  expect(screen.queryByRole('button', { name: 'Ordinary · ORD' })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Test Dashboard navigation' }));
  expect(await screen.findByText('10 issued shares')).toBeTruthy();
  expect(screen.getByRole('img', { name: /3 unvested, 2 vested, awaiting issue, 0 issued from award/ })).toBeTruthy();
  const awardsCard = screen.getByRole('heading', { name: 'Employee awards' }).closest('section')!;
  expect(within(awardsCard).getByText('5 shares promised')).toBeTruthy();
  expect(
    within(awardsCard)
      .getAllByRole('term')
      .map((item) => item.textContent),
  ).toEqual(['Unvested', 'Vested, awaiting issue']);
  expect(screen.queryByRole('button', { name: 'Read own entries for Ordinary' })).toBeNull();
  expect(api.get.mock.calls.some(([url]) => url === WALLET_ENDPOINTS.BASE)).toBe(false);
  expect(screen.queryByRole('heading', { name: 'Shares in your wallets' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Accept another member invitation' })).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Member invitation code' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Refresh member records' })).toBeNull();
  expect(screen.queryByText(MEMBER_RECORD.name)).toBeNull();
  expect(screen.queryByText(MEMBER_RECORD.residentialAddress)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Request update' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Share history' })).toBeNull();
  expect(screen.queryByRole('button', { name: `Open ${MEMBER_RECORD.company.name} member record` })).toBeNull();
  expect(screen.queryByText('Recent changes · Ordinary')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Request certificate (Ordinary, entry 1)' })).toBeNull();
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
  expect(await screen.findByText('15 issued shares')).toBeTruthy();
  expect(screen.getByRole('img', { name: /0 unvested, 0 vested, awaiting issue, 5 issued from award/ })).toBeTruthy();
  const issuedAwardCard = screen.getByRole('heading', { name: 'Employee awards' }).closest('section')!;
  expect(
    within(issuedAwardCard)
      .getAllByRole('term')
      .map((item) => item.textContent),
  ).toEqual(['Issued from award']);
  expect(screen.queryByText('20 issued shares')).toBeNull();
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
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  await screen.findByRole('img', {
    name: /1 unvested, 1 vested, awaiting issue, 1 issued from award, 1 unvested rights ended, 1 vested rights ended/,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Award details' }));
  expect(screen.getByText(/Company selected reduction/)).toBeTruthy();
  expect(screen.getByText(/Correct recorded quantity/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Download.*(entitlement|correction)/ })).toBeNull();
  record = { ...MEMBER_RECORD, classes: [] };
  await focusRead();
  expect(await screen.findByText('No issued shares yet.')).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(screen.getByRole('img', { name: /3 unvested, 2 vested, awaiting issue, 0 issued from award/ })).toBeTruthy();
  record = {
    ...record,
    awards: [{ ...MEMBER_RECORD.awards[0], vestedShares: '6', availableShares: '6' }],
  };
  await focusRead();
  await screen.findByText('Your member records could not be loaded.');
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.queryByText('No issued shares yet.')).toBeNull();
  record = {
    ...record,
    awards: [{ ...MEMBER_RECORD.awards[0], shares: '0', vestedShares: '0', availableShares: '0' }],
  };
  await focusRead();
  await screen.findByText('Your member records could not be loaded.');
  expect(screen.queryByRole('img')).toBeNull();
  record = MEMBER_RECORD;
  await focusRead();
  await screen.findByText('10 issued shares');
  fireEvent.click(screen.getByRole('link', { name: 'Test Settings navigation' }));
  expect(await screen.findByText(MEMBER_RECORD.name)).toBeTruthy();
  expect(screen.getByText(MEMBER_RECORD.residentialAddress)).toBeTruthy();
  fireEvent.click(screen.getByText('Request update'));
  fireEvent.change(screen.getByRole('textbox', { name: 'Requested name' }), { target: { value: 'Retained draft' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Requested residential address' }), {
    target: { value: 'Retained draft address' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: /Share these requested particulars/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('textbox', { name: 'Requested name' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Request update' }));
  expect((screen.getByRole('textbox', { name: 'Requested name' }) as HTMLInputElement).value).toBe('Retained draft');
  fireEvent.click(screen.getByRole('link', { name: 'Test Dashboard navigation' }));
  await screen.findByText('10 issued shares');
  expect(screen.queryByRole('textbox', { name: 'Requested name' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Request update' })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Test Documents navigation' }));
  await screen.findByRole('button', { name: 'Request certificate (Ordinary, entry 1)' });
  expect(screen.queryByRole('heading', { name: 'Update requests' })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Test Settings navigation' }));
  expect((screen.getByRole('textbox', { name: 'Requested name' }) as HTMLInputElement).value).toBe('Retained draft');
  await act(async () => {
    await client.refetchQueries({ queryKey: USER_PREFERENCES_QUERY_KEY, exact: true });
  });
  await focusRead();
  await waitFor(() =>
    expect((screen.getByRole('textbox', { name: 'Requested name' }) as HTMLInputElement).value).toBe('Retained draft'),
  );
  expect((screen.getByRole('textbox', { name: 'Requested residential address' }) as HTMLTextAreaElement).value).toBe(
    'Retained draft address',
  );
  expect(
    (screen.getByRole('checkbox', { name: /Share these requested particulars/ }) as HTMLInputElement).checked,
  ).toBe(true);
  expect(api.get.mock.calls.some(([url]) => url === URLS.HOLDERS(MEMBER_RECORD.classes[0].uuid))).toBe(false);
  expect(screen.queryByRole('button', { name: 'Request certificate (Ordinary, entry 1)' })).toBeNull();
  await act(async () => {
    await client.refetchQueries({ queryKey: ['member-records', 'profile-one', 'account-one', 0], exact: true });
  });
  expect((screen.getByRole('textbox', { name: 'Requested name' }) as HTMLInputElement).value).toBe('Retained draft');
  fireEvent.click(screen.getByRole('link', { name: 'Test Documents navigation' }));
  expect(await screen.findByRole('heading', { name: 'Documents', level: 1 })).toBeTruthy();
  expect(screen.queryByText('10 issued shares')).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByRole('button', { name: 'Request certificate (Ordinary, entry 1)' })).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: 'Test Dashboard navigation' }));
  await screen.findByText('10 issued shares');
  expect(screen.getByRole('img', { name: /Your issued shares by class/ })).toBeTruthy();
  await waitFor(() => expect(client.isFetching()).toBe(0));
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const beforeOffline = api.get.mock.calls.filter(([url]) => url === URLS.MEMBER_RECORDS).length;
  refused = true;
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(api.get.mock.calls.filter(([url]) => url === URLS.MEMBER_RECORDS)).toHaveLength(beforeOffline);
  online.mockReturnValue(true);
  fireEvent(window, new Event('online'));
  await screen.findByText('Your member records could not be loaded.');
  await waitFor(() => expect(screen.queryByText('10 issued shares')).toBeNull());
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Request certificate (Ordinary, entry 1)' })).toBeNull();
  expect(screen.getByText('Your member records could not be loaded.')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Get access to your shares' })).toBeNull();
  expect(screen.queryByText('No issued shares yet.')).toBeNull();
  refused = false;
  fireEvent.click(
    screen.getByRole('button', { name: 'Try again', description: 'Your member records could not be loaded.' }),
  );
  await screen.findByText('10 issued shares');
  expect(screen.getByRole('img', { name: /Your issued shares by class/ })).toBeTruthy();
  includeOther = true;
  otherRecord = { ...otherRecordWithShares, classes: [] };
  await focusRead();
  expect((screen.getByRole('combobox', { name: 'Company' }) as HTMLInputElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('link', { name: 'Test Settings navigation' }));
  expect((screen.getByRole('textbox', { name: 'Requested name' }) as HTMLInputElement).value).toBe('Retained draft');
  await choose('Company', otherRecord.company.name);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Request update' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Request update' }));
  expect((screen.getByRole('textbox', { name: 'Requested name' }) as HTMLInputElement).value).toBe('');
  expect((screen.getByRole('textbox', { name: 'Requested residential address' }) as HTMLTextAreaElement).value).toBe(
    '',
  );
  expect(
    (screen.getByRole('checkbox', { name: /Share these requested particulars/ }) as HTMLInputElement).checked,
  ).toBe(false);
  fireEvent.change(screen.getByRole('textbox', { name: 'Requested name' }), {
    target: { value: 'Second company draft' },
  });
  await choose('Company', MEMBER_RECORD.company.name);
  fireEvent.click(await screen.findByRole('button', { name: 'Request update' }));
  expect((screen.getByRole('textbox', { name: 'Requested name' }) as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByRole('link', { name: 'Test Documents navigation' }));
  await choose('Company', otherRecord.company.name);
  await screen.findByText('No share changes yet.');
  await choose('Company', MEMBER_RECORD.company.name);
  await screen.findByRole('button', { name: 'Request certificate (Ordinary, entry 1)' });
  fireEvent.click(screen.getByRole('link', { name: 'Test Dashboard navigation' }));
  otherRecord = otherRecordWithShares;
  await focusRead();
  detailRefused = true;
  await focusRead();
  await screen.findByText('Your member records could not be loaded.');
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.queryByText('10 issued shares')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Request certificate (Ordinary, entry 1)' })).toBeNull();
  expect((screen.getByRole('combobox', { name: 'Company' }) as HTMLInputElement).disabled).toBe(false);
  await choose('Company', otherRecord.company.name);
  await screen.findByText('25 issued shares');
  expect(screen.getByRole('heading', { name: otherRecord.company.name })).toBeTruthy();
  expect(screen.getByRole('img', { name: /Your issued shares by class/ })).toBeTruthy();
  expect(screen.queryByText('10 issued shares')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  await waitFor(() => expect(client.isFetching()).toBe(0));
  fireEvent.click(screen.getByRole('link', { name: 'Test Settings navigation' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Request update' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Requested name' }), {
    target: { value: 'Private previous-account draft' },
  });
  includeOther = false;
  currentPreferences = {
    userProfile: 'profile-two',
    userAccount: { uuid: 'account-two', role: 'investor' },
  };
  await act(async () => client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: currentPreferences }));
  await screen.findByRole('heading', { name: 'Get access to your shares' });
  expect(screen.queryByRole('textbox', { name: 'Requested name' })).toBeNull();
  expect(screen.queryByText(MEMBER_RECORD.residentialAddress)).toBeNull();
  detailRefused = false;
  currentPreferences = preferences;
  await act(async () => client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: preferences }));
  fireEvent.click(await screen.findByRole('button', { name: 'Request update' }));
  expect((screen.getByRole('textbox', { name: 'Requested name' }) as HTMLInputElement).value).toBe('');
  expect((screen.getByRole('textbox', { name: 'Requested residential address' }) as HTMLTextAreaElement).value).toBe(
    '',
  );
  expect(
    (screen.getByRole('checkbox', { name: /Share these requested particulars/ }) as HTMLInputElement).checked,
  ).toBe(false);
  await waitFor(() => expect(client.isFetching()).toBe(0));
  view.unmount();
  const beforeUnmounted = api.get.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(api.get.mock.calls).toHaveLength(beforeUnmounted);
});
