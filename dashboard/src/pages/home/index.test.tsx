// @vitest-environment jsdom

import { PageTitle } from '@components/PageTitle';
import { ApiClientProvider, HOLDING_ASSET_TYPE, WALLET_ENDPOINTS, type WalletHolding } from '@ledova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AxiosInstance } from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HomePage } from './index';

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
