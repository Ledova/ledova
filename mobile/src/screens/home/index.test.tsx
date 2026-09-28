import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HOLDING_ASSET_TYPE, WALLET_ENDPOINTS, type WalletHolding } from '@ledova/shared';
import { HomeScreen } from './index';
import { apiClient } from '../../services/apiClient';

jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn() } }));
jest.mock('./components/HoldingWork', () => ({ HoldingWork: () => null }));
jest.mock('./useHoldingWork', () => ({ useHoldingWork: () => ({ refresh: jest.fn(), isRefreshing: false }) }));

const get = jest.mocked(apiClient.get);
let client: QueryClient;

const firstWallet = { uuid: 'wallet-one', name: 'Primary', address: `0x${'1'.repeat(40)}`, chain: 'base' };
const secondWallet = { uuid: 'wallet-two', name: 'Reserve', address: `0x${'2'.repeat(40)}`, chain: 'ethereum' };

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

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  get.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

it('keeps Holdings visible while wallets load, then distinguishes a crypto-only empty ledger', async () => {
  let finish!: (value: ReturnType<typeof page>) => void;
  get.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
  const coin = holding();
  get.mockResolvedValue({
    data: [holding({ asset: { ...coin.asset, assetType: HOLDING_ASSET_TYPE.STABLECOIN }, quantity: '0.01' })],
  });
  const view = await render(<HomeScreen />, { wrapper });
  expect(view.getByRole('header', { name: 'Holdings' })).toBeTruthy();
  expect(view.getByText('Loading your holdings…')).toBeTruthy();
  expect(
    view.queryByText(
      "None of your wallets holds shares yet. The company's register is the record of what you hold; shares appear here once they are in one of your wallets.",
    ),
  ).toBeNull();
  await act(async () => finish(page()));
  expect(
    await view.findByText(
      "None of your wallets holds shares yet. The company's register is the record of what you hold; shares appear here once they are in one of your wallets.",
    ),
  ).toBeTruthy();
  expect(view.queryByText(/0 shares|AUD|USD/)).toBeNull();
});

it('adds every wallet page exactly and expands chain and wallet detail without needing visible class metadata', async () => {
  get.mockImplementation(async (url, config) => {
    if (url === WALLET_ENDPOINTS.BASE)
      return (config?.params as { page?: number } | undefined)?.page === 2
        ? page([secondWallet])
        : page([firstWallet], 'https://example.test/wallets/?page=2');
    if (url === WALLET_ENDPOINTS.HOLDINGS(firstWallet.uuid))
      return { data: [holding({ quantity: '9007199254740993.000000000000000000' })] };
    return {
      data: [
        holding({ chain: 'ethereum', quantity: '2' }),
        holding({ assetUuid: 'hidden-class', assetName: 'Hidden Example Ordinary', quantity: '3', shareClass: null }),
      ],
    };
  });
  const view = await render(<HomeScreen />, { wrapper });
  const row = await view.findByRole('button', {
    name: 'Harbour Example Pty Ltd, Ordinary, 9,007,199,254,740,995 shares',
  });
  expect(row.props.accessibilityState).toEqual({ expanded: false });
  expect(view.getByText('Hidden Example Ordinary')).toBeTruthy();
  expect(view.queryByText('Primary')).toBeNull();
  await fireEvent.press(row);
  expect(row.props.accessibilityState).toEqual({ expanded: true });
  expect(view.getByText('Primary')).toBeTruthy();
  expect(view.getByText('Reserve')).toBeTruthy();
  expect(view.getAllByText('9,007,199,254,740,993 shares')).toHaveLength(2);
  expect(get).toHaveBeenCalledWith(WALLET_ENDPOINTS.BASE, { params: { page: 2 } });
  await fireEvent.press(view.getByText('Ordinary'));
  expect(view.queryByText('Primary')).toBeNull();
});

it.each(['first page', 'second page', 'one holding', 'malformed next', 'fractional shares'])(
  'hides partial totals when %s fails and recovers on retry',
  async (failure) => {
    let failed = true;
    get.mockImplementation(async (url, config) => {
      if (url === WALLET_ENDPOINTS.BASE) {
        if ((config?.params as { page?: number } | undefined)?.page === 2) {
          if (failed && failure === 'second page') throw new Error('Unavailable');
          return page([secondWallet]);
        }
        if (failed && failure === 'first page') throw new Error('Unavailable');
        return page(
          [firstWallet],
          failed && failure === 'malformed next'
            ? 'https://example.test/wallets/?page=oops'
            : 'https://example.test/wallets/?page=2',
        );
      }
      if (failed && failure === 'one holding' && url === WALLET_ENDPOINTS.HOLDINGS(secondWallet.uuid))
        throw new Error('Unavailable');
      return { data: [holding({ quantity: failed && failure === 'fractional shares' ? '1.5' : '10' })] };
    });
    const view = await render(<HomeScreen />, { wrapper });
    expect(await view.findByRole('alert')).toHaveTextContent("We couldn't load all your holdings.");
    expect(view.queryByText('Harbour Example Pty Ltd')).toBeNull();
    expect(
      view.queryByText(
        "None of your wallets holds shares yet. The company's register is the record of what you hold; shares appear here once they are in one of your wallets.",
      ),
    ).toBeNull();
    failed = false;
    await fireEvent.press(view.getByRole('button', { name: 'Try again' }));
    expect(await view.findByText('20 shares')).toBeTruthy();
    expect(view.queryByRole('alert')).toBeNull();
  },
);

it('refreshes after existing wallet invalidations and hides a stale total if that refresh fails', async () => {
  let quantity = '1';
  let failed = false;
  get.mockImplementation(async (url) => {
    if (failed) throw new Error('Unavailable');
    return url === WALLET_ENDPOINTS.BASE ? page() : { data: [holding({ quantity })] };
  });
  const view = await render(<HomeScreen />, { wrapper });
  expect(await view.findByText('1 share')).toBeTruthy();
  quantity = '2';
  await act(async () => client.invalidateQueries({ queryKey: ['wallets'] }));
  expect(await view.findByText('2 shares')).toBeTruthy();
  failed = true;
  await act(async () => client.invalidateQueries({ queryKey: ['wallets'] }));
  await waitFor(() => expect(view.getByRole('alert')).toBeTruthy());
  expect(view.queryByText('2 shares')).toBeNull();
});
