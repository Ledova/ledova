// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiClientProvider, HOLDING_ASSET_TYPE, WALLET_ENDPOINTS, type WalletHolding } from '@ledova/shared';
import { PageTitle } from '@components/PageTitle';
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
    shareClass: { uuid: 'class-one', name: 'Ordinary', companyName: 'Harbour Example Pty Ltd' },
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

function renderPage() {
  return render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api as unknown as AxiosInstance}>
        <PageTitle.Provider value="Holdings">
          <HomePage />
        </PageTitle.Provider>
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

it('waits for the wallet read with its title intact and without claiming there are no shares', async () => {
  let finish!: (value: ReturnType<typeof page>) => void;
  api.get.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  renderPage();

  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Holdings');
  expect(screen.getByRole('status').textContent).toBe('Loading your holdings…');
  expect(
    screen.queryByText(
      "None of your wallets holds shares yet. The company's register is the record of what you hold; shares appear here once they are in one of your wallets.",
    ),
  ).toBeNull();

  await act(async () => finish(page([])));
  expect(
    await screen.findByText(
      "None of your wallets holds shares yet. The company's register is the record of what you hold; shares appear here once they are in one of your wallets.",
    ),
  ).toBeTruthy();
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

  const summary = screen.getByText('Ordinary').closest('summary');
  expect(summary).not.toBeNull();
  fireEvent.click(summary!);
  expect(summary!.closest('details')!.open).toBe(true);
  expect(screen.getByText('Primary')).toBeTruthy();
  expect(screen.getAllByText('Reserve').length).toBeGreaterThan(0);
});

it('treats a crypto-only wallet as an empty share list without inventing a zero valuation', async () => {
  const share = holding();
  api.get.mockImplementation(async (url: string) =>
    url === WALLET_ENDPOINTS.BASE
      ? page()
      : { data: [holding({ asset: { ...share.asset, assetType: HOLDING_ASSET_TYPE.STABLECOIN }, quantity: '0.01' })] },
  );
  renderPage();

  expect(
    await screen.findByText(
      "None of your wallets holds shares yet. The company's register is the record of what you hold; shares appear here once they are in one of your wallets.",
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/0 shares|AUD|USD/)).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it.each(['wallet page one', 'wallet page two', 'one wallet holding'])(
  'offers retry after failure of %s without showing partial totals',
  async (failure) => {
    let failed = true;
    api.get.mockImplementation(async (url: string, config?: { params?: { page?: number } }) => {
      if (url === WALLET_ENDPOINTS.BASE) {
        if (config?.params?.page === 2) {
          if (failed && failure === 'wallet page two') throw new Error('Unavailable');
          return page([secondWallet]);
        }
        if (failed && failure === 'wallet page one') throw new Error('Unavailable');
        return page([firstWallet], 'https://example.test/api/wallets/?page=2');
      }
      if (url === WALLET_ENDPOINTS.HOLDINGS(secondWallet.uuid) && failed && failure === 'one wallet holding') {
        throw new Error('Unavailable');
      }
      return { data: [holding({ quantity: '10' })] };
    });
    renderPage();

    expect((await screen.findByRole('alert')).textContent).toContain("We couldn't load all your holdings.");
    expect(
      screen.queryByText(
        "None of your wallets holds shares yet. The company's register is the record of what you hold; shares appear here once they are in one of your wallets.",
      ),
    ).toBeNull();
    expect(screen.queryByText('Harbour Example Pty Ltd')).toBeNull();

    failed = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Harbour Example Pty Ltd')).toBeTruthy();
    expect(screen.getAllByText('20 shares').length).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).toBeNull();
  },
);

it('refreshes share counts when existing wallet actions invalidate wallets', async () => {
  let quantity = '1';
  api.get.mockImplementation(async (url: string) =>
    url === WALLET_ENDPOINTS.BASE ? page() : { data: [holding({ quantity })] },
  );
  renderPage();
  const name = await screen.findByText('Ordinary');
  expect(name.closest('summary')!.textContent).toContain('1 share');

  quantity = '2';
  await act(async () => client.invalidateQueries({ queryKey: ['wallets'] }));
  await waitFor(() => expect(name.closest('summary')!.textContent).toContain('2 shares'));
});

it('reports a malformed share balance instead of rounding it into a whole-share claim', async () => {
  api.get.mockImplementation(async (url: string) =>
    url === WALLET_ENDPOINTS.BASE ? page() : { data: [holding({ quantity: '1.5' })] },
  );
  renderPage();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Harbour Example Pty Ltd')).toBeNull();
});
