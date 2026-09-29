// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
});

it('lists each verified wallet under its network with its balance and value labelled as a Wallets row does', async () => {
  show();
  const dialog = await screen.findByRole('dialog', { name: 'Select your wallet' });
  const choice = await within(dialog).findByRole('button', { name: /Savings/ });

  expect(api.get).toHaveBeenCalledWith(WALLET_ENDPOINTS.BASE, {
    params: { verification_status: 'VERIFIED', ordering: 'signing_preference' },
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
    ['Ethereum', 'Bitcoin', 'Base'].map((network) => within(dialog).getByText(network).nextElementSibling?.textContent),
  ).toEqual([
    expect.stringContaining('Savings'),
    expect.stringContaining('Cold storage'),
    expect.stringContaining(formatWalletAddressShort(everyday.address)),
  ]);

  fireEvent.click(within(dialog).getByRole('button', { name: /Cold storage/ }));
  expect(chosen).toHaveBeenCalledExactlyOnceWith(cold);
});
