// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { USER_ACCOUNT_ENDPOINTS, type AccountRole } from '@ledova/shared';

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
  it.each([
    ['investor', true],
    ['company', false],
    ['both', true],
  ] as const)('offers Buy crypto to the %s role: %s', async (role, offered) => {
    await openWallets(role);

    expect(screen.queryByRole('button', { name: 'Buy crypto' }) !== null).toBe(offered);
  });

  it.each(['investor', 'company', 'both'] as const)('offers Send to the %s role', async (role) => {
    await openWallets(role);

    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });

  it('offers Buy crypto only once the role is known', async () => {
    api.get.mockImplementation((url: string) =>
      url === USER_ACCOUNT_ENDPOINTS.BASE ? new Promise(() => {}) : Promise.resolve(walletList),
    );
    await openWallets();

    expect(screen.queryByRole('button', { name: 'Buy crypto' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });

  it('opens the Buy flow at its first step from Buy crypto', async () => {
    await openWallets('investor');
    expect(screen.queryByText('Select an asset to purchase')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Buy crypto' }));

    expect(await screen.findByText('Select an asset to purchase')).toBeTruthy();
  });

  it('opens the Send wallet picker from Send', async () => {
    await openWallets('company');
    expect(screen.queryByText('Select your wallet')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Select your wallet')).toBeTruthy();
  });
});
