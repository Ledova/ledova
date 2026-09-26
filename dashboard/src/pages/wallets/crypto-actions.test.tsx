// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WALLET_ENDPOINTS, type AccountRole } from '@ledova/shared';

const api = vi.hoisted(() => ({ get: vi.fn(), setActions: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('@hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock('@hooks/useSelectedPortfolio', () => ({
  useSelectedPortfolio: () => ({ portfolio: { userAccount: 'owner' }, userAccount: { uuid: 'owner' } }),
}));
vi.mock('@hooks/useHeaderActions', () => ({ useHeaderActions: () => ({ setActions: api.setActions }) }));
vi.mock('@hooks/useCurrency', () => ({
  useCurrency: () => ({ formatDisplayCurrency: (value: number) => `$${value}` }),
}));
vi.mock('@keystonehq/animated-qr', () => ({ AnimatedQRCode: () => null }));

import { BuyCryptoProvider } from '@hooks/useBuyCrypto';
import { WalletsPage } from './index';

const walletList = {
  data: {
    results: [
      {
        uuid: 'wallet-1',
        userAccount: 'owner',
        name: 'Base wallet',
        address: `0x${'3'.repeat(40)}`,
        chain: 'base',
        verificationStatus: 'VERIFIED',
        nativeBalance: '5',
        marketValue: '10',
      },
    ],
    count: 1,
    next: null,
    previous: null,
  },
};
let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.get.mockResolvedValue(walletList);
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

async function openWallets(role?: AccountRole) {
  if (role) queryClient.setQueryData(['userAccount'], { data: { role } });
  render(
    <QueryClientProvider client={queryClient}>
      <BuyCryptoProvider>
        <WalletsPage />
      </BuyCryptoProvider>
    </QueryClientProvider>,
  );
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
    render(
      <QueryClientProvider client={queryClient}>
        <BuyCryptoProvider>
          <WalletsPage />
        </BuyCryptoProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Select your wallet')).toBeTruthy();

    api.get.mockImplementation(() => new Promise(() => {}));
    await act(async () => {
      void queryClient.invalidateQueries({ queryKey: ['wallets'] });
    });

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Buy crypto' })).toBeNull());
    expect(screen.getByText('Select your wallet')).toBeTruthy();
  });

  it('opens the Send wallet picker from Send', async () => {
    await openWallets('company');
    expect(screen.queryByText('Select your wallet')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Select your wallet')).toBeTruthy();
  });
});
