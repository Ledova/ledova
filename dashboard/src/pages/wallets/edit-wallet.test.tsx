// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import { AUTH_QUERY_KEY, USER_PREFERENCES_QUERY_KEY, ApiClientProvider } from '@ledova/shared';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('@ledova/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ledova/shared')>()),
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
  queryClient.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  queryClient.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: 'profile', userAccount: { uuid: 'owner', role: 'investor' } },
  });
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

function edit(wallet: string) {
  fireEvent.click(within(screen.getByRole('group', { name: wallet })).getByRole('button', { name: 'Edit' }));
}

it('opens each wallet with its saved name and discards an edit that was not saved', async () => {
  render(
    <ApiClientProvider client={api as unknown as AxiosInstance}>
      <QueryClientProvider client={queryClient}>
        <WalletsPage />
      </QueryClientProvider>
    </ApiClientProvider>,
  );
  await screen.findByText('Saved wallet');
  edit('Saved wallet');
  expect(nameInput().value).toBe('Saved wallet');
  fireEvent.change(nameInput(), { target: { value: 'Unsaved name' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByPlaceholderText('Enter wallet name (optional)')).toBeNull();

  edit('Saved wallet');
  expect(nameInput().value).toBe('Saved wallet');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  edit('Other wallet');
  expect(nameInput().value).toBe('Other wallet');
  expect(api.patch).not.toHaveBeenCalled();
});
