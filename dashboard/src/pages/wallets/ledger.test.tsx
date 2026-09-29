// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WALLET_ENDPOINTS, type DerivedAddress, type HardwareWalletImport } from '@ledova/shared';
import { WalletsPage } from './index';
import { useWallets } from './hooks/useWallets';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('@ledova/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ledova/shared')>()),
  useCurrency: () => ({ formatDisplayCurrency: (value: number) => `AUD ${value}` }),
}));
vi.mock('./components/CryptoActions', () => ({ CryptoActions: () => null }));
const wallet = {
  uuid: 'one',
  name: 'Primary wallet',
  address: `0x${'1'.repeat(40)}`,
  chain: 'base',
  verificationStatus: 'VERIFIED',
  nativeBalance: '1',
  nativeMarketValue: '10',
  marketValue: '10',
};
const second = { ...wallet, uuid: 'two', name: 'Reserve wallet', address: `0x${'2'.repeat(40)}` };
const page = (results: unknown[], next: string | null = null) => ({
  data: { results, count: results.length, next, previous: null },
});
let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function show() {
  return render(<WalletsPage />, { wrapper });
}
function actOn(wallet: string, action: string) {
  fireEvent.click(within(screen.getByRole('group', { name: wallet })).getByRole('button', { name: action }));
}

beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.get.mockResolvedValue(page([wallet]));
  api.post.mockResolvedValue({ data: wallet });
  api.patch.mockResolvedValue({ data: wallet });
  api.delete.mockResolvedValue({ data: {} });
});
afterEach(() => {
  cleanup();
  client.clear();
});

it('reads every wallet page without changing other wallet cache shapes', async () => {
  client.setQueryData(['wallets'], page([wallet]));
  api.get.mockImplementation(async (_url: string, config: { params: { page: number } }) =>
    config.params.page === 2 ? page([second]) : page([wallet], 'https://example.test/wallets/?page=2'),
  );
  show();
  expect(await screen.findByText('Reserve wallet')).toBeTruthy();
  expect(screen.getByText('Primary wallet')).toBeTruthy();
  expect(api.get).toHaveBeenCalledWith(WALLET_ENDPOINTS.BASE, { params: { page: 2 } });
  expect(client.getQueryData(['wallets'])).toEqual(page([wallet]));
});

it.each(['failed second page', 'malformed next', 'stale refresh'])(
  'hides incomplete wallets after %s and retries',
  async (mode) => {
    let broken = mode !== 'stale refresh';
    api.get.mockImplementation(async (_url: string, config: { params: { page: number } }) => {
      if (config.params.page === 2) {
        if (broken) throw Error('Unavailable');
        return page([second]);
      }
      return page(
        [wallet],
        broken && mode === 'malformed next' ? 'https://example.test/?page=no' : 'https://example.test/?page=2',
      );
    });
    show();
    if (mode === 'stale refresh') {
      await screen.findByText('Reserve wallet');
      broken = true;
      await act(async () => client.invalidateQueries({ queryKey: ['wallets'] }));
    }
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Primary wallet')).toBeNull();
    expect(screen.queryByText('No Base wallets yet.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add wallet' })).toBeNull();
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Reserve wallet')).toBeTruthy();
  },
);

it('retains an edit while a delayed write rejects, then closes only after successful retry', async () => {
  let reject!: (error: Error) => void;
  api.patch.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  show();
  await screen.findByText('Primary wallet');
  actOn('Primary wallet', 'Edit');
  const dialog = screen.getByRole('dialog', { name: 'Edit Wallet' });
  expect(within(dialog).getByText('Address').tagName).toBe('DT');
  fireEvent.change(within(dialog).getByLabelText('Wallet name'), { target: { value: 'Retained name' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
  await within(dialog).findByRole('button', { name: 'Loading...' });
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBe(dialog);
  await act(async () => reject(Error('Save refused')));
  expect(await within(dialog).findByRole('alert')).toBeTruthy();
  expect(within(dialog).getByLabelText('Wallet name')).toHaveProperty('value', 'Retained name');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.patch).toHaveBeenLastCalledWith(WALLET_ENDPOINTS.DETAIL('one'), { name: 'Retained name' });
});

it('keeps a prepared edit through failed background reads and withholds saving until recovery', async () => {
  show();
  await screen.findByText('Primary wallet');
  actOn('Primary wallet', 'Edit');
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Wallet name'), { target: { value: 'Kept draft' } });
  api.get.mockRejectedValue(Error('Unavailable'));
  await act(async () => client.invalidateQueries({ queryKey: ['wallets'] }));
  await within(dialog).findByText('Wallets could not be refreshed. Your draft is kept; retry before continuing.');
  expect(screen.getByRole('dialog')).toBe(dialog);
  expect(within(dialog).getByLabelText('Wallet name')).toHaveProperty('value', 'Kept draft');
  expect(within(dialog).getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  expect(api.patch).not.toHaveBeenCalled();
  api.get.mockResolvedValue(page([wallet]));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Retry wallets' }));
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false));
  expect(within(dialog).getByLabelText('Wallet name')).toHaveProperty('value', 'Kept draft');
});

it('keeps a refused delete confirmation open and requires a successful retry', async () => {
  api.delete.mockRejectedValueOnce(Error('Cannot delete'));
  show();
  await screen.findByText('Primary wallet');
  actOn('Primary wallet', 'Delete');
  const dialog = screen.getByRole('dialog', { name: 'Delete Wallet' });
  expect(within(dialog).getByText('Primary wallet')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
  expect(await within(dialog).findByRole('alert')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.delete).toHaveBeenCalledTimes(2);
});

it('lists the networks as Ethereum, Bitcoin and Base, one card each', async () => {
  show();
  await screen.findByText('Primary wallet');

  expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
    'Ethereum',
    'Bitcoin',
    'Base',
  ]);
});

it('states each empty chain in one sentence under its title and offers Add wallet once, in the title row', async () => {
  api.get.mockResolvedValue(page([]));
  show();
  for (const chain of ['Ethereum', 'Bitcoin', 'Base']) {
    const section = (await screen.findByRole('heading', { level: 2, name: chain })).closest('section')!;
    expect(within(section).getByText(`No ${chain} wallets yet.`).tagName).toBe('P');
    expect(within(section).queryAllByRole('button')).toHaveLength(0);
  }
  const add = screen.getByRole('button', { name: 'Add wallet' });
  expect(add.closest('header')).toBeTruthy();
  fireEvent.click(add);
  expect(within(screen.getByRole('dialog', { name: 'Add wallet' })).getByLabelText('Wallet address')).toBeTruthy();
});

it('retains a refused new wallet and closes only on successful creation', async () => {
  api.post.mockRejectedValueOnce(Error('Cannot add'));
  show();
  await screen.findByText('Primary wallet');
  fireEvent.click(screen.getByRole('button', { name: 'Add wallet' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Wallet address'), { target: { value: second.address } });
  fireEvent.change(within(dialog).getByLabelText('Wallet name'), { target: { value: 'New name' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add Wallet' }));
  expect(await within(dialog).findByRole('alert')).toBeTruthy();
  expect(within(dialog).getByLabelText('Wallet name')).toHaveProperty('value', 'New name');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add Wallet' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.post).toHaveBeenCalledTimes(2);
});

it('retries only unconfirmed addresses after a partially successful hardware import', async () => {
  const addresses = [wallet, second].map((value, index) => ({
    address: value.address,
    networkType: 'BASE',
    addressIndex: index,
    derivationPath: `m/44'/60'/0'/0/${index}`,
  })) as DerivedAddress[];
  const importData = { addresses, parentKeys: [], masterFingerprint: '12345678' } as HardwareWalletImport;
  api.post
    .mockResolvedValueOnce({ data: wallet })
    .mockRejectedValueOnce(Error('Second refused'))
    .mockResolvedValueOnce({ data: second });
  const { result } = renderHook(useWallets, { wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  const completed = vi.fn();
  act(() => result.current.handleBatchCreateWallets(addresses, importData, completed));
  await waitFor(() => expect(result.current.createError).toContain('1 wallet(s) added'));
  expect(completed).not.toHaveBeenCalled();
  act(() => result.current.handleBatchCreateWallets(addresses, importData, completed));
  await waitFor(() => expect(completed).toHaveBeenCalledOnce());
  expect(api.post.mock.calls.map((call) => call[1].address)).toEqual([wallet.address, second.address, second.address]);
});
