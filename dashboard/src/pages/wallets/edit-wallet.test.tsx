// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('@hooks/useSelectedPortfolio', () => ({
  useSelectedPortfolio: () => ({ portfolio: { userAccount: 'owner' } }),
}));
vi.mock('@hooks/useCurrency', () => ({
  useCurrency: () => ({ formatDisplayCurrency: (value: number) => `$${value}` }),
}));
vi.mock('./components/CryptoActions', () => ({ CryptoActions: () => null }));

import { WalletsPage } from './index';

const wallet = {
  uuid: 'wallet-1',
  userAccount: 'owner',
  name: 'Saved wallet',
  address: `0x${'3'.repeat(40)}`,
  chain: 'base',
  verificationStatus: 'VERIFIED',
  nativeBalance: '5',
  marketValue: '10',
};
const other = { ...wallet, uuid: 'wallet-2', name: 'Other wallet', chain: 'ethereum' };
let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.get.mockResolvedValue({ data: { results: [wallet, other], count: 2, next: null, previous: null } });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

function nameInput() {
  return screen.getByPlaceholderText('Enter wallet name (optional)') as HTMLInputElement;
}

it('opens each wallet with its saved name and discards an edit that was not saved', async () => {
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/wallets']}>
        <WalletsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.doubleClick(await screen.findByText('Saved wallet'));
  expect(nameInput().value).toBe('Saved wallet');
  fireEvent.change(nameInput(), { target: { value: 'Unsaved name' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByPlaceholderText('Enter wallet name (optional)')).toBeNull();

  fireEvent.doubleClick(screen.getByText('Saved wallet'));
  expect(nameInput().value).toBe('Saved wallet');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  fireEvent.doubleClick(screen.getByText('Other wallet'));
  expect(nameInput().value).toBe('Other wallet');
  expect(api.patch).not.toHaveBeenCalled();
});
