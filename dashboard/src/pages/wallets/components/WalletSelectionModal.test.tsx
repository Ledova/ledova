// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WALLET_ENDPOINTS, formatWalletAddressShort } from '@ledova/shared';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('@ledova/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ledova/shared')>()),
  useCurrency: () => ({ formatDisplayCurrency: (value: number) => `AUD ${value.toFixed(2)}` }),
}));

import { WalletSelectionModal } from './WalletSelectionModal';

function wallet(uuid: string, chain: string, name: string, nativeBalance: string, marketValue: string) {
  return {
    uuid,
    chain,
    name,
    nativeBalance,
    marketValue,
    userAccount: 'owner',
    address: chain === 'bitcoin' ? `tb1q${uuid.repeat(38).slice(0, 38)}` : `0x${uuid.repeat(40).slice(0, 40)}`,
    verificationStatus: 'VERIFIED',
  };
}

const savings = wallet('a', 'ethereum', 'Savings', '0.42', '0.5');
const cold = wallet('b', 'bitcoin', 'Cold storage', '0.001', '60');
const everyday = wallet('c', 'base', '', '0', '0');
let client: QueryClient;
const chosen = vi.fn();

function show() {
  render(
    <QueryClientProvider client={client}>
      <WalletSelectionModal isOpen onClose={() => {}} onSelectWallet={chosen} />
    </QueryClientProvider>,
  );
}

const figuresOf = (choice: HTMLElement) =>
  Array.from(within(choice).getByText('Balance').parentElement!.children).map((cell) => cell.textContent);

beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.get.mockResolvedValue({ data: { results: [savings, cold, everyday], count: 3, next: null, previous: null } });
});

afterEach(() => {
  cleanup();
  client.clear();
  onlineManager.setOnline(true);
});

it('lists each verified wallet under its network with its balance and value labelled as a Wallets row does', async () => {
  show();
  const dialog = await screen.findByRole('dialog', { name: 'Select your wallet' });
  const choice = await within(dialog).findByRole('button', { name: /Savings/ });

  expect(api.get).toHaveBeenCalledWith(WALLET_ENDPOINTS.BASE, {
    params: { verification_status: 'VERIFIED', ordering: 'signing_preference', page: 1 },
  });
  expect(figuresOf(choice)).toEqual(['Balance', '0.42 ETH', 'Value', 'AUD 0.50']);
  expect(within(choice).queryByText(savings.address)).toBeNull();
  expect(figuresOf(within(dialog).getByRole('button', { name: /Cold storage/ }))).toEqual([
    'Balance',
    '0.001 BTC',
    'Value',
    'AUD 60.00',
  ]);
  const unnamed = within(dialog).getByRole('button', { name: new RegExp(formatWalletAddressShort(everyday.address)) });
  expect(figuresOf(unnamed)).toEqual(['Balance', '0 ETH', 'Value', 'AUD 0.00']);
  expect(
    within(dialog)
      .getAllByText(/^(Ethereum|Bitcoin|Base)$/)
      .map((network) => network.textContent),
  ).toEqual(['Ethereum', 'Bitcoin', 'Base']);
  expect(
    ['Ethereum', 'Bitcoin', 'Base'].map((network) => within(dialog).getByText(network).nextElementSibling?.textContent),
  ).toEqual([
    expect.stringContaining('Savings'),
    expect.stringContaining('Cold storage'),
    expect.stringContaining(formatWalletAddressShort(everyday.address)),
  ]);

  fireEvent.click(within(dialog).getByRole('button', { name: /Cold storage/ }));
  expect(chosen).toHaveBeenCalledExactlyOnceWith(cold);
});

it('offers every verified wallet when they fill more than one page', async () => {
  api.get.mockImplementation(async (_url: string, config: { params: { page?: number } }) =>
    (config.params.page ?? 1) === 1
      ? {
          data: {
            results: [savings, cold],
            count: 3,
            next: 'https://example.test/api/wallets/?page=2',
            previous: null,
          },
        }
      : { data: { results: [everyday], count: 3, next: null, previous: null } },
  );
  show();
  const dialog = await screen.findByRole('dialog', { name: 'Select your wallet' });

  const onSecondPage = await within(dialog).findByRole('button', {
    name: new RegExp(formatWalletAddressShort(everyday.address)),
  });
  expect(within(dialog).getByRole('button', { name: /Savings/ })).toBeTruthy();
  expect(within(dialog).getByRole('button', { name: /Cold storage/ })).toBeTruthy();
  expect(api.get.mock.calls.map(([, config]) => config.params)).toEqual([
    { verification_status: 'VERIFIED', ordering: 'signing_preference', page: 1 },
    { verification_status: 'VERIFIED', ordering: 'signing_preference', page: 2 },
  ]);

  fireEvent.click(onSecondPage);
  expect(chosen).toHaveBeenCalledExactlyOnceWith(everyday);
});

it('says the wallets could not be loaded when the read fails, rather than that there are none, and tries again', async () => {
  api.get.mockRejectedValueOnce(new Error('Request failed with status code 500'));
  show();

  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('Your wallets could not be loaded. Try again before continuing.');
  expect(screen.queryByText('No verified wallets found')).toBeNull();
  expect(screen.queryByText('Request failed with status code 500')).toBeNull();

  fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

  expect(await screen.findByRole('button', { name: /Savings/ })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(api.get).toHaveBeenCalledTimes(2);
});

it('hides the wallets it listed when a refresh fails, and holds Try again while it reads them again', async () => {
  show();
  await screen.findByRole('button', { name: /Savings/ });
  api.get.mockRejectedValueOnce(new Error('Request failed with status code 500'));

  await act(async () => client.invalidateQueries({ queryKey: ['wallets'] }));

  const alert = await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: /Savings/ })).toBeNull();
  let settle!: () => void;
  api.get.mockReturnValueOnce(
    new Promise((resolve) => {
      settle = () => resolve({ data: { results: [savings, cold, everyday], count: 3, next: null, previous: null } });
    }),
  );
  fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

  await waitFor(() =>
    expect(within(alert).getByRole('button', { name: 'Try again' })).toHaveProperty('disabled', true),
  );
  await act(async () => settle());
  expect(await screen.findByRole('button', { name: /Savings/ })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('waits for its first read while offline, rather than saying there are no wallets', async () => {
  onlineManager.setOnline(false);
  show();

  const dialog = await screen.findByRole('dialog', { name: 'Select your wallet' });
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(within(dialog).getByText('Loading wallets...')).toBeTruthy();
  expect(within(dialog).queryByText('No verified wallets found')).toBeNull();
  expect(api.get).not.toHaveBeenCalled();

  act(() => onlineManager.setOnline(true));

  expect(await within(dialog).findByRole('button', { name: /Savings/ })).toBeTruthy();
  expect(api.get).toHaveBeenCalledOnce();
});
