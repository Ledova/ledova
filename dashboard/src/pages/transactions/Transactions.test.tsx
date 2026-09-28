// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TRANSACTION_ENDPOINTS, WALLET_ENDPOINTS, getBlockExplorerTxUrl, type Transaction } from '@ledova/shared';
import { PageTitle } from '@components/PageTitle';
import TransactionsPage from './index';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
const wallet = { uuid: 'wallet-one', name: 'Primary wallet', address: `0x${'a'.repeat(40)}`, chain: 'base' };
const secondWallet = { ...wallet, uuid: 'wallet-two', name: 'Reserve wallet', address: `0x${'b'.repeat(40)}` };
const transaction: Transaction = {
  uuid: 'entry-one',
  createdAt: '2026-09-01T10:00:00Z',
  txHash: `0x${'17'.repeat(32)}`,
  chain: 'base',
  fromAddress: wallet.address,
  toAddress: secondWallet.address,
  walletAddress: wallet.address,
  wallet: wallet.uuid,
  asset: 'asset-one',
  assetName: 'Example settlement asset',
  assetSymbol: 'AUDX',
  amount: '9007199254740993.000000000000000001',
  marketValue: null,
  blockTimestamp: null,
  blockNumber: null,
  status: 'pending',
  transactionFee: '0.000000000000000001',
  transactionFeeEstimated: null,
};
function page<T>(results: T[], next: string | null = null) {
  return { data: { results, next, previous: null, count: results.length } };
}
let client: QueryClient;
let activity: (params: Record<string, unknown>) => Promise<unknown>;
let wallets: (params: Record<string, unknown>) => Promise<unknown>;
function show() {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/transactions']}>
        <PageTitle.Provider value="Activity">
          <TransactionsPage />
        </PageTitle.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const activityReads = () => api.get.mock.calls.filter(([url]) => url === TRANSACTION_ENDPOINTS.BASE);
beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  activity = async () => page([transaction]);
  wallets = async () => page([wallet]);
  api.get.mockImplementation((url: string, config?: { params?: Record<string, unknown> }) => {
    if (url === TRANSACTION_ENDPOINTS.BASE) return activity(config?.params ?? {});
    if (url === WALLET_ENDPOINTS.BASE) return wallets(config?.params ?? {});
    throw Error(`Unexpected read ${url}`);
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it('offers only Filter in the title row, leaving Notices to the sidebar', () => {
  show();
  expect(screen.getByRole('button', { name: 'Filter' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Open Notices' })).toBeNull();
});

it('loads history independently of an empty wallet selector and preserves exact amounts', async () => {
  wallets = async () => page([]);
  show();
  expect(await screen.findByRole('button', { name: /Outgoing · Example settlement asset/ })).toBeTruthy();
  expect(screen.getByText('9,007,199,254,740,993.000000000000000001 AUDX')).toBeTruthy();
  expect(screen.getByText('Pending')).toBeTruthy();
  expect(activityReads()).toHaveLength(1);
});

it('keeps history usable while filter wallets are loading', async () => {
  let finish!: (response: ReturnType<typeof page>) => void;
  wallets = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  show();
  expect(await screen.findByText('Pending')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('Loading wallets…')).toBeTruthy();
  expect(within(dialog).getByLabelText('Wallet')).toHaveProperty('disabled', true);
  await act(async () => finish(page([wallet])));
  expect(await within(dialog).findByRole('option', { name: /Primary wallet/ })).toBeTruthy();
});

it('loads every filter wallet page into its own cache and sends supported filters with inclusive local date bounds', async () => {
  client.setQueryData(['wallets'], page([wallet]));
  wallets = async (params) =>
    params.page === 1 ? page([wallet], 'https://example.invalid/api/wallets/?page=2') : page([secondWallet]);
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
  const dialog = screen.getByRole('dialog');
  expect(await within(dialog).findByRole('option', { name: /Reserve wallet/ })).toBeTruthy();
  expect(client.getQueryData(['wallets'])).toEqual(page([wallet]));
  fireEvent.change(within(dialog).getByLabelText('Wallet'), { target: { value: 'wallet-two' } });
  fireEvent.change(within(dialog).getByLabelText('Network'), { target: { value: 'base' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Incoming' }));
  expect(within(dialog).getByRole('button', { name: 'Incoming' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.change(within(dialog).getByLabelText('From date'), { target: { value: '2026-09-01' } });
  fireEvent.change(within(dialog).getByLabelText('Through date'), { target: { value: '2026-09-02' } });
  expect(within(dialog).queryByPlaceholderText('Min')).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(activityReads()).toHaveLength(2));
  const params = activityReads()[1][1].params;
  expect(params).toMatchObject({ wallet: 'wallet-two', chain: 'base', direction: 'incoming', page: 1 });
  const from = new Date(params.start_date),
    through = new Date(params.end_date);
  expect([from.getFullYear(), from.getMonth(), from.getDate(), from.getHours(), from.getMinutes()]).toEqual([
    2026, 8, 1, 0, 0,
  ]);
  expect([
    through.getFullYear(),
    through.getMonth(),
    through.getDate(),
    through.getHours(),
    through.getMinutes(),
    through.getSeconds(),
    through.getMilliseconds(),
  ]).toEqual([2026, 8, 2, 23, 59, 59, 999]);
  expect(params).not.toHaveProperty('min_amount');
  expect(params).not.toHaveProperty('max_amount');
});

it('reports failed filter wallet pagination without hiding history, retaining draft filters through retry', async () => {
  let broken = true;
  wallets = async (params) => {
    if (params.page === 1) return page([wallet], 'https://example.invalid/api/wallets/?page=2');
    if (broken) throw Error('Unavailable');
    return page([secondWallet]);
  };
  show();
  expect(await screen.findByText('Pending')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
  const dialog = screen.getByRole('dialog');
  expect(
    await within(dialog).findByText('Wallet filters could not be loaded. Your activity can still be viewed.'),
  ).toBeTruthy();
  expect(within(dialog).queryByRole('option', { name: /Primary wallet/ })).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Outgoing' }));
  fireEvent.change(within(dialog).getByLabelText('From date'), { target: { value: '2026-09-01' } });
  broken = false;
  fireEvent.click(within(dialog).getByRole('button', { name: 'Try wallets again' }));
  expect(await within(dialog).findByRole('option', { name: /Reserve wallet/ })).toBeTruthy();
  expect(within(dialog).getByLabelText('From date')).toHaveProperty('value', '2026-09-01');
  expect(within(dialog).getByRole('button', { name: 'Outgoing' }).getAttribute('aria-pressed')).toBe('true');
});

it('rejects an inverted date range before making a filtered request and can clear the draft', async () => {
  show();
  await screen.findByText('Pending');
  fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('From date'), { target: { value: '2026-09-10' } });
  fireEvent.change(within(dialog).getByLabelText('Through date'), { target: { value: '2026-09-01' } });
  expect(within(dialog).getByRole('alert').textContent).toContain('must be on or after');
  expect(within(dialog).getByRole('button', { name: 'Apply' })).toHaveProperty('disabled', true);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  expect(activityReads()).toHaveLength(1);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
  expect(await screen.findByLabelText('From date')).toHaveProperty('value', '');
});

it('distinguishes a pending read from an empty history', async () => {
  let finish!: (response: ReturnType<typeof page>) => void;
  activity = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  show();
  expect(screen.getByText('Loading activity…')).toBeTruthy();
  expect(screen.queryByText('No activity yet.')).toBeNull();
  await act(async () => finish(page([])));
  expect(await screen.findByText('No activity yet.')).toBeTruthy();
  expect(screen.getByRole('heading', { level: 2, name: 'Transfers' })).toBeTruthy();
});

it('keeps the Transfers title when filters match nothing and clears them from that state', async () => {
  activity = async (params) => page(params.direction === 'outgoing' ? [] : [transaction]);
  show();
  await screen.findByText('Pending');
  fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Outgoing' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  expect(await screen.findByText('No matching activity.')).toBeTruthy();
  expect(screen.getByRole('heading', { level: 2, name: 'Transfers' })).toBeTruthy();
  expect(screen.queryByText('No activity yet.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(await screen.findByText('Pending')).toBeTruthy();
  expect(screen.queryByText('No matching activity.')).toBeNull();
});

it('reports an initial history failure and retries without presenting an empty result', async () => {
  activity = async () => {
    throw Error('Unavailable');
  };
  show();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('No activity yet.')).toBeNull();
  activity = async () => page([transaction]);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Pending')).toBeTruthy();
});

it('keeps a failed later page visible as incomplete and retries it', async () => {
  let broken = true;
  activity = async (params) => {
    if (params.page === 1) return page([transaction], 'https://example.invalid/api/transactions/?page=2');
    if (broken) throw Error('Unavailable');
    return page([{ ...transaction, uuid: 'earlier', status: 'confirmed' }]);
  };
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Load more activity' }));
  expect(await screen.findByText('More activity could not be loaded. The list is incomplete.')).toBeTruthy();
  expect(screen.getByText('Pending')).toBeTruthy();
  broken = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try more activity again' }));
  expect(await screen.findByText('✓ Confirmed')).toBeTruthy();
  expect(activityReads().at(-1)?.[1].params.page).toBe(2);
});

it('does not claim an empty first page is complete while a later page is outstanding', async () => {
  activity = async (params) =>
    params.page === 1 ? page([], 'https://example.invalid/api/transactions/?page=2') : page([transaction]);
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Load more activity' }));
  expect(screen.queryByText('No activity yet.')).toBeNull();
  expect(await screen.findByText('Pending')).toBeTruthy();
});

it('suppresses stale activity detail after a failed refresh and recovers the current status', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: /Outgoing · Example settlement asset/ }));
  expect(await screen.findByRole('dialog')).toBeTruthy();
  activity = async () => {
    throw Error('Unavailable');
  };
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['transactions'] });
  });
  expect(await screen.findByRole('alert')).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.queryByText('Pending')).toBeNull();
  activity = async () => page([{ ...transaction, status: 'confirmed' }]);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('✓ Confirmed')).toBeTruthy();
});

it.each(['https://example.invalid/api/transactions/?page=1', 'https://example.invalid/api/transactions/'])(
  'refuses malformed or nonadvancing history pages: %s',
  async (next) => {
    activity = async () => page([transaction], next);
    show();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Pending')).toBeNull();
  },
);

it('shows exact amounts, native network fees and full identities in a read-only detail', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  show();
  fireEvent.click(await screen.findByRole('button', { name: /Outgoing · Example settlement asset/ }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(transaction.txHash)).toBeTruthy();
  expect(within(dialog).getByText('0.000000000000000001 ETH')).toBeTruthy();
  expect(within(dialog).getByText('9,007,199,254,740,993.000000000000000001 AUDX')).toBeTruthy();
  expect(within(dialog).queryByText('Block time')).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: 'View on Explorer' }));
  expect(open).toHaveBeenCalledExactlyOnceWith(
    getBlockExplorerTxUrl('base', transaction.txHash),
    '_blank',
    'noopener,noreferrer',
  );
});

it.each([
  ['-0.5', '-0.5 AUDX'],
  ['-0.000000000000000001', '-0.000000000000000001 AUDX'],
  ['-1000.50', '-1,000.5 AUDX'],
  ['0.0000', '0 AUDX'],
])('preserves the recorded sign and precision of %s', async (amount, expected) => {
  activity = async () => page([{ ...transaction, amount }]);
  show();
  expect(await screen.findByText(expected)).toBeTruthy();
});
