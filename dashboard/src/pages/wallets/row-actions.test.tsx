// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WALLET_ENDPOINTS } from '@ledova/shared';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
const keys = vi.hoisted(() => ({ derive: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('@utils/keystone/bcurDecoder', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@utils/keystone/bcurDecoder')>()),
  deriveAddressFromParentKey: keys.derive,
}));
vi.mock('@ledova/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ledova/shared')>()),
  useCurrency: () => ({ formatDisplayCurrency: (value: number) => `AUD ${value}` }),
}));
vi.mock('./components/CryptoActions', () => ({ CryptoActions: () => null }));

import { WalletsPage } from './index';

const common = { userAccount: 'owner', nativeBalance: '0', nativeMarketValue: '0', marketValue: '0' };
const everyday = {
  ...common,
  uuid: 'everyday',
  name: 'Everyday',
  address: `0x${'1'.repeat(40)}`,
  chain: 'base',
  verificationStatus: 'VERIFIED',
};
const savings = {
  ...common,
  uuid: 'savings',
  name: 'Savings',
  address: `0x${'2'.repeat(40)}`,
  chain: 'ethereum',
  verificationStatus: 'PENDING',
};
const keystone = {
  ...common,
  uuid: 'keystone',
  name: 'Keystone',
  address: `0x${'3'.repeat(40)}`,
  chain: 'ethereum',
  verificationStatus: 'VERIFIED',
  signingPreference: 'hardware',
  masterFingerprint: 'a1b2c3d4',
  parentPublicKey: 'synthetic-public-key',
  parentChainCode: 'synthetic-chain-code',
  parentDerivationPath: "m/44'/60'/0'/0",
  addressIndex: 0,
};
let client: QueryClient;

function show() {
  render(
    <QueryClientProvider client={client}>
      <WalletsPage />
    </QueryClientProvider>,
  );
}

const actionsOf = (wallet: string) => screen.getByRole('group', { name: wallet });
const labels = (wallet: string) =>
  within(actionsOf(wallet))
    .getAllByRole('button')
    .map((button) => button.textContent);

beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.get.mockResolvedValue({ data: { results: [everyday, savings, keystone], count: 3, next: null, previous: null } });
});

afterEach(() => {
  cleanup();
  client.clear();
});

it('gives every wallet its own actions, with nothing to select first and no toolbar under the list', async () => {
  show();
  await screen.findByText('Everyday');

  expect(labels('Everyday')).toEqual(['Edit', 'Sync', 'Delete']);
  expect(labels('Savings')).toEqual(['Edit', 'Verify', 'Sync', 'Delete']);
  expect(labels('Keystone')).toEqual(['Edit', 'Derive address', 'Sync', 'Delete']);
  for (const wallet of [everyday, savings, keystone]) {
    const row = actionsOf(wallet.name).closest('li')!;
    expect(within(row).getByText(wallet.address)).toBeTruthy();
    expect(within(row).getAllByRole('group')).toHaveLength(1);
  }
  expect(screen.queryByRole('button', { name: /Everyday|Savings|Keystone/ })).toBeNull();
  expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0);
  expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
  for (const action of within(actionsOf('Savings')).getAllByRole('button')) {
    expect(action.className).toMatch(/\bw-fit\b/);
    expect(action.className).not.toMatch(/\b(w-full|flex-1)\b/);
  }
});

it('starts verification for the wallet whose row Verify is in', async () => {
  api.post.mockReturnValue(new Promise(() => {}));
  show();
  await screen.findByText('Savings');

  fireEvent.click(within(actionsOf('Savings')).getByRole('button', { name: 'Verify' }));
  const dialog = await screen.findByRole('dialog', { name: 'Verify Wallet' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Sign with a seed phrase' }));

  await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
  expect(api.post.mock.calls[0][0]).toBe(WALLET_ENDPOINTS.REQUEST_VERIFICATION('savings'));
});

it('derives the next address from the parent key of the wallet whose row Derive address is in', async () => {
  keys.derive.mockReturnValue({
    address: `0x${'4'.repeat(40)}`,
    networkType: 'ETH',
    addressIndex: 1,
    derivationPath: "m/44'/60'/0'/0/1",
  });
  show();
  await screen.findByText('Keystone');

  fireEvent.click(within(actionsOf('Keystone')).getByRole('button', { name: 'Derive address' }));

  const dialog = await screen.findByRole('dialog', { name: 'Derive New Address' });
  expect(keys.derive).toHaveBeenCalledWith('synthetic-public-key', 'synthetic-chain-code', "m/44'/60'/0'/0", 1);
  expect(within(dialog).getByText(`0x${'4'.repeat(40)}`)).toBeTruthy();
});

it('asks to delete the wallet whose row Delete is in, and deletes that one on confirmation', async () => {
  api.delete.mockResolvedValue({ data: {} });
  show();
  await screen.findByText('Savings');

  fireEvent.click(within(actionsOf('Savings')).getByRole('button', { name: 'Delete' }));
  const dialog = await screen.findByRole('dialog', { name: 'Delete Wallet' });
  expect(within(dialog).getByText('Savings')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

  await waitFor(() => expect(api.delete).toHaveBeenCalledOnce());
  expect(api.delete.mock.calls[0][0]).toBe(WALLET_ENDPOINTS.DETAIL('savings'));
});
