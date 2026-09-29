// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WALLET_ENDPOINTS, formatWalletAddressShort, type AccountRole } from '@ledova/shared';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('@ledova/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ledova/shared')>()),
  useUserPreferences: () => ({ userAccount: { uuid: 'owner' } }),
  useAuth: () => ({ isAuthenticated: true }),
  useCurrency: () => ({ formatDisplayCurrency: (value: number) => `$${value}` }),
}));
vi.mock('@hooks/useSignupFinished', () => ({ useSignupFinished: () => true }));
vi.mock('@components/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('@components/MobileHeader', () => ({ MobileHeader: () => null }));
vi.mock('@keystonehq/animated-qr', () => ({ AnimatedQRCode: () => null }));

import Layout from '@components/Layout';
import { WalletsPage } from './index';

const baseWallet = {
  uuid: 'wallet-1',
  userAccount: 'owner',
  name: 'Base wallet',
  address: `0x${'3'.repeat(40)}`,
  chain: 'base',
  verificationStatus: 'VERIFIED',
  nativeBalance: '5',
  marketValue: '10',
};
const pendingWallet = {
  ...baseWallet,
  uuid: 'wallet-2',
  name: 'Awaiting verification',
  address: `0x${'4'.repeat(40)}`,
  verificationStatus: 'PENDING',
};
const reserveWallet = { ...baseWallet, uuid: 'wallet-3', name: 'Reserve wallet', address: `0x${'5'.repeat(40)}` };
const listOf = (results: unknown[]) => ({ data: { results, count: results.length, next: null, previous: null } });
const walletList = listOf([baseWallet, pendingWallet]);
let queryClient: QueryClient;
let router: ReturnType<typeof createMemoryRouter>;

function renderWalletsInTheFrame() {
  router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <Layout>
            <Routes>
              <Route path="/wallets" element={<WalletsPage />} />
              <Route path="/elsewhere" element={<p>Another page</p>} />
            </Routes>
          </Layout>
        ),
      },
    ],
    { initialEntries: ['/wallets'] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function answer(wallets: ReturnType<typeof listOf>) {
  api.get.mockImplementation((url: string, config?: { params?: Record<string, unknown> }) => {
    if (url.endsWith('/holdings/')) return Promise.resolve({ data: [] });
    if (url === WALLET_ENDPOINTS.BASE && config?.params?.verification_status === 'VERIFIED') {
      return Promise.resolve(
        listOf(
          wallets.data.results.filter((wallet) => (wallet as typeof baseWallet).verificationStatus === 'VERIFIED'),
        ),
      );
    }
    return Promise.resolve(wallets);
  });
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  answer(walletList);
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

async function openWallets(role?: AccountRole) {
  if (role) queryClient.setQueryData(['userAccount'], { data: { role } });
  renderWalletsInTheFrame();
  await screen.findByText('Base wallet');
}

describe('crypto on the Wallets page', () => {
  it.each(['investor', 'company', 'both'] as const)('offers Buy crypto to the %s role', async (role) => {
    await openWallets(role);

    expect(screen.getByRole('button', { name: 'Buy crypto' })).toBeTruthy();
  });

  it.each(['investor', 'company', 'both'] as const)('offers Send to the %s role', async (role) => {
    await openWallets(role);

    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });

  it('opens the Buy flow at its first step from Buy crypto', async () => {
    await openWallets('investor');
    expect(screen.queryByText('Select an asset to purchase')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Buy crypto' }));

    expect(await screen.findByText('Select an asset to purchase')).toBeTruthy();
  });

  it('keeps an open Send flow when the wallet list is fetched again after a failed first load', async () => {
    api.get.mockImplementation((url: string) =>
      url === WALLET_ENDPOINTS.BASE ? Promise.reject(new Error('Network unavailable')) : Promise.resolve(walletList),
    );
    queryClient.setQueryData(['userAccount'], { data: { role: 'investor' } });
    renderWalletsInTheFrame();
    fireEvent.click(await screen.findByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Select your wallet')).toBeTruthy();

    api.get.mockImplementation(() => new Promise(() => {}));
    await act(async () => {
      void queryClient.invalidateQueries({ queryKey: ['wallets'] });
    });

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Buy crypto' })).toBeNull());
    expect(screen.getByText('Select your wallet')).toBeTruthy();
  });

  it('goes straight to the send form for the only verified wallet, with Cancel where Back would lead nowhere', async () => {
    await openWallets('company');
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    const form = await screen.findByRole('dialog', { name: 'Send' });
    expect(screen.queryByText('Select your wallet')).toBeNull();
    expect(within(form).getByText(formatWalletAddressShort(baseWallet.address))).toBeTruthy();
    expect(within(form).queryByRole('button', { name: 'Back' })).toBeNull();
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it("states the wallet's native balance once, in its unit, on the asset row and as the most it can send", async () => {
    await openWallets('investor');

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    const form = await screen.findByRole('dialog', { name: 'Send' });
    const ether = await within(form).findByRole('button', { name: /^ETH/ });
    expect(within(ether).getByText('5 ETH')).toBeTruthy();
    expect(within(form).getByText('Max: 5 ETH')).toBeTruthy();
    expect(within(form).queryByText(/ETH ETH/)).toBeNull();
  });

  it('asks which wallet to send from when several are verified, and goes Back to that choice', async () => {
    answer(listOf([baseWallet, pendingWallet, reserveWallet]));
    await openWallets('investor');

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    const chooser = await screen.findByRole('dialog', { name: 'Select your wallet' });
    fireEvent.click(await within(chooser).findByText('Reserve wallet'));
    const form = await screen.findByRole('dialog', { name: 'Send' });
    expect(within(form).getByText(formatWalletAddressShort(reserveWallet.address))).toBeTruthy();
    fireEvent.click(within(form).getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('dialog', { name: 'Select your wallet' })).toBeTruthy();
  });

  it.each([
    ['Send', 'Send'],
    ['Buy crypto', 'Buy crypto'],
  ])('keeps an open %s flow when the person leaves Wallets, since the frame holds it', async (action, firstStep) => {
    await openWallets('investor');
    fireEvent.click(screen.getByRole('button', { name: action }));
    expect(await screen.findByRole('dialog', { name: firstStep })).toBeTruthy();

    await act(async () => {
      await router.navigate('/elsewhere');
    });

    expect(await screen.findByText('Another page')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Buy crypto', hidden: true })).toBeNull();
    expect(screen.getByRole('dialog', { name: firstStep })).toBeTruthy();
  });
});
