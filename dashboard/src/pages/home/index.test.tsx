// @vitest-environment jsdom

import { PageTitle } from '@components/PageTitle';
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
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HomePage } from './index';
import MemberRecordsPage from '../member-records';
import { MEMBER_ENTRY, MEMBER_RECORD } from '../../../../packages/shared/tests/fixtures/member-access';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('./components/HoldingWork', () => ({ HoldingWork: () => null }));

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

it('puts own register shares and awards first without wallet reads, preserves selected history on refresh and hides revoked records without an empty-ownership claim', async () => {
  const preferences = { userProfile: 'profile-one', userAccount: { uuid: 'account-one', role: 'investor' } };
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: preferences });
  let refused = false;
  let record = MEMBER_RECORD;
  api.get.mockImplementation(async (url: string) => {
    if (url === '/api/user-preferences/') return { data: preferences };
    if (url === URLS.MEMBER_RECORDS) {
      if (refused) throw Object.assign(new Error('Current association revoked'), { response: { status: 404 } });
      return { data: { results: [record], next: null, count: 1 } };
    }
    if (url === URLS.MEMBER_RECORD(MEMBER_RECORD.uuid)) return { data: record };
    if (url === URLS.MEMBER_ENTRIES(MEMBER_RECORD.uuid)) return { data: { entries: [MEMBER_ENTRY] } };
    if (url === URLS.MEMBER_PARTICULARS_REQUESTS || url === URLS.MEMBER_CERTIFICATE_REQUESTS)
      return { data: { results: [], next: null, count: 0 } };
    throw new Error(`Unexpected request: ${url}`);
  });
  render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api as unknown as AxiosInstance}>
        <MemoryRouter>
          <PageTitle.Provider value="My shares">
            <MemberRecordsPage />
          </PageTitle.Provider>
        </MemoryRouter>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('10 issued shares')).toBeTruthy();
  expect(screen.getByRole('img', { name: /3 unvested, 2 vested, awaiting issue, 0 issued from award/ })).toBeTruthy();
  await screen.findByRole('button', { name: 'Read own entries for Ordinary' });
  expect(api.get.mock.calls.some(([url]) => url === WALLET_ENDPOINTS.BASE)).toBe(false);
  expect(screen.queryByRole('heading', { name: 'Shares in your wallets' })).toBeNull();
  const invitation = screen.getByText('Accept another member invitation').closest('details');
  expect(invitation?.open).toBe(false);
  await screen.findByText('Recent changes · Ordinary');
  fireEvent.click(screen.getByRole('button', { name: `Open ${MEMBER_RECORD.company.name} member record` }));
  expect(screen.getByText('Recent changes · Ordinary')).toBeTruthy();
  record = {
    ...MEMBER_RECORD,
    classes: [{ ...MEMBER_RECORD.classes[0], shares: '15' }],
    awards: [{ ...MEMBER_RECORD.awards[0], vestedShares: '5', issuedShares: '5', availableShares: '0' }],
  };
  fireEvent.click(screen.getByRole('button', { name: 'Refresh member records' }));
  expect(await screen.findByText('15 issued shares')).toBeTruthy();
  expect(screen.getByRole('img', { name: /0 unvested, 0 vested, awaiting issue, 5 issued from award/ })).toBeTruthy();
  expect(screen.queryByText('20 issued shares')).toBeNull();
  record = { ...MEMBER_RECORD, classes: [] };
  fireEvent.click(screen.getByRole('button', { name: 'Refresh member records' }));
  expect(await screen.findByText('No issued shares recorded.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: `Open ${MEMBER_RECORD.company.name} member record` }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(screen.getByRole('img', { name: /3 unvested, 2 vested, awaiting issue, 0 issued from award/ })).toBeTruthy();
  record = {
    ...record,
    awards: [{ ...MEMBER_RECORD.awards[0], vestedShares: '6', availableShares: '6' }],
  };
  fireEvent.click(screen.getByRole('button', { name: 'Refresh member records' }));
  await screen.findByText('Award quantities are unavailable. Refresh the current record.');
  expect(screen.queryByRole('img')).toBeNull();
  record = {
    ...record,
    awards: [{ ...MEMBER_RECORD.awards[0], shares: '0', vestedShares: '0', availableShares: '0' }],
  };
  fireEvent.click(screen.getByRole('button', { name: 'Refresh member records' }));
  await screen.findByText('No award shares recorded.');
  expect(screen.queryByRole('img')).toBeNull();
  record = MEMBER_RECORD;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh member records' }));
  await screen.findByText('10 issued shares');
  expect(api.get.mock.calls.some(([url]) => url === URLS.HOLDERS(MEMBER_RECORD.classes[0].uuid))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Read own entries for Ordinary' }));
  await screen.findByRole('button', { name: 'Request certificate for entry 1' });
  await act(async () => {
    await client.refetchQueries({ queryKey: ['member-records', 'profile-one', 'account-one', 0], exact: true });
  });
  expect(await screen.findByRole('button', { name: 'Request certificate for entry 1' })).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: 'View documents and certificate requests' }));
  expect(await screen.findByRole('heading', { name: 'Documents', level: 1 })).toBeTruthy();
  expect(screen.queryByText('10 issued shares')).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByRole('button', { name: 'Request certificate for entry 1' })).toBeTruthy();
  refused = true;
  await act(async () => {
    await client.refetchQueries({ queryKey: ['member-records', 'profile-one', 'account-one', 0], exact: true });
  });
  await waitFor(() => expect(screen.queryByText('10 issued shares')).toBeNull());
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Request certificate for entry 1' })).toBeNull();
  expect(screen.getByRole('alert').textContent).toMatch(/could not be read/);
  expect(screen.queryByRole('heading', { name: 'Get access to your shares' })).toBeNull();
  expect(screen.queryByText('No issued shares recorded.')).toBeNull();
});
