// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import { AUTH_QUERY_KEY, USER_PREFERENCES_QUERY_KEY, ApiClientProvider } from '@ledova/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
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
  name: 'Sync wallet',
  address: `0x${'3'.repeat(40)}`,
  chain: 'base',
  verificationStatus: 'VERIFIED',
  nativeBalance: '5',
  marketValue: '10',
};
const other = { ...wallet, uuid: 'wallet-2', name: 'Other wallet', chain: 'ethereum' };
let queryClient: QueryClient;

const rowOf = (name: string) => screen.getByRole('group', { name }).closest('li')!;
const syncOf = (name: string) => within(screen.getByRole('group', { name })).getByRole('button', { name: /^Sync/ });

function show() {
  render(
    <ApiClientProvider client={api as unknown as AxiosInstance}>
      <QueryClientProvider client={queryClient}>
        <WalletsPage />
      </QueryClientProvider>
    </ApiClientProvider>,
  );
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  queryClient.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  queryClient.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: 'profile', userAccount: { uuid: 'owner', role: 'investor' } },
  });
  api.get.mockResolvedValue({ data: { results: [wallet], count: 1, next: null, previous: null } });
  api.post.mockReset();
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe('wallet sync feedback through the real service and mutation', () => {
  it('shows a failed sync in the row of the wallet it belongs to, and nowhere else', async () => {
    api.get.mockResolvedValue({ data: { results: [wallet, other], count: 2, next: null, previous: null } });
    const error = 'Some wallet balances could not be refreshed. Please try again later.';
    api.post.mockResolvedValueOnce({ data: { success: false, wallet, syncResult: { status: 'error', error } } });
    show();
    await screen.findByText('Sync wallet');

    fireEvent.click(syncOf('Sync wallet'));

    expect((await within(rowOf('Sync wallet')).findByRole('alert')).textContent).toBe(error);
    expect(within(rowOf('Other wallet')).queryByRole('alert')).toBeNull();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('marks the syncing wallet and holds every Sync until the request settles', async () => {
    api.get.mockResolvedValue({ data: { results: [wallet, other], count: 2, next: null, previous: null } });
    let settle!: (value: unknown) => void;
    api.post.mockReturnValueOnce(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    show();
    await screen.findByText('Sync wallet');

    fireEvent.click(syncOf('Sync wallet'));

    await waitFor(() => expect(syncOf('Sync wallet').textContent).toBe('Syncing…'));
    expect(syncOf('Other wallet').textContent).toBe('Sync');
    expect(syncOf('Sync wallet')).toHaveProperty('disabled', true);
    expect(syncOf('Other wallet')).toHaveProperty('disabled', true);
    fireEvent.click(syncOf('Other wallet'));
    expect(api.post).toHaveBeenCalledTimes(1);

    await act(async () => settle({ data: { success: true, wallet, syncResult: { status: 'success' } } }));
    await waitFor(() => expect(syncOf('Sync wallet').textContent).toBe('Sync'));
    expect(syncOf('Sync wallet')).toHaveProperty('disabled', false);
    expect(syncOf('Other wallet')).toHaveProperty('disabled', false);
  });

  it.each([
    ['skipped', 'Verify this wallet before syncing it.'],
    ['error', 'Some wallet balances could not be refreshed. Please try again later.'],
  ])('shows a %s result and clears it after a successful retry', async (status, error) => {
    api.post.mockResolvedValueOnce({ data: { success: false, wallet, syncResult: { status, error } } });
    show();
    await screen.findByText('Sync wallet');
    fireEvent.click(syncOf('Sync wallet'));
    expect((await screen.findByRole('alert')).textContent).toBe(error);
    api.post.mockResolvedValueOnce({ data: { success: true, wallet, syncResult: { status: 'success' } } });
    fireEvent.click(syncOf('Sync wallet'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(api.post).toHaveBeenCalledTimes(2);
  });
});
