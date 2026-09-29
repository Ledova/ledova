// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
const entryName = /Outgoing · Example settlement asset/;
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
const filterToggle = () => screen.getByRole('button', { name: /^Filter/ });
const detailOf = (entry: HTMLElement) => document.getElementById(entry.getAttribute('aria-controls')!)!;
function openFilter() {
  fireEvent.click(filterToggle());
  return screen.getByRole('region', { name: /^Filter/ });
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

it('opens the filter in place at the top of Transfers, with no title action, dialog or Notices link', async () => {
  show();
  await screen.findByText('Pending');
  const title = screen.getByRole('heading', { level: 1, name: 'Activity' });
  expect(within(title.parentElement!).queryAllByRole('button')).toHaveLength(0);
  expect(screen.queryByRole('link', { name: 'Open Notices' })).toBeNull();
  const transfers = screen.getByRole('heading', { level: 2, name: 'Transfers' }).closest('section')!;
  const toggle = within(transfers).getByRole('button', { name: /^Filter/ });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('region', { name: /^Filter/ })).toBeNull();

  fireEvent.click(toggle);
  const region = screen.getByRole('region', { name: /^Filter/ });
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(toggle.getAttribute('aria-controls')).toBe(region.id);
  expect(transfers.contains(region)).toBe(true);
  expect(within(region).getByRole('group', { name: 'Direction' })).toBeTruthy();
  expect(within(region).getByLabelText('Network')).toBeTruthy();
  expect(within(region).getByLabelText('Wallet')).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();

  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('region', { name: /^Filter/ })).toBeNull();
});

it('loads history independently of an empty wallet selector and preserves exact amounts', async () => {
  wallets = async () => page([]);
  show();
  expect(await screen.findByRole('button', { name: entryName })).toBeTruthy();
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
  const filter = openFilter();
  expect(within(filter).getByText('Loading wallets…')).toBeTruthy();
  expect(within(filter).getByLabelText('Wallet')).toHaveProperty('disabled', true);
  await act(async () => finish(page([wallet])));
  expect(await within(filter).findByRole('option', { name: /Primary wallet/ })).toBeTruthy();
});

it('loads every filter wallet page into its own cache and sends supported filters with inclusive local date bounds', async () => {
  client.setQueryData(['wallets'], page([wallet]));
  wallets = async (params) =>
    params.page === 1 ? page([wallet], 'https://example.invalid/api/wallets/?page=2') : page([secondWallet]);
  show();
  const filter = openFilter();
  expect(await within(filter).findByRole('option', { name: /Reserve wallet/ })).toBeTruthy();
  expect(client.getQueryData(['wallets'])).toEqual(page([wallet]));
  fireEvent.change(within(filter).getByLabelText('Wallet'), { target: { value: 'wallet-two' } });
  fireEvent.change(within(filter).getByLabelText('Network'), { target: { value: 'base' } });
  fireEvent.click(within(filter).getByRole('button', { name: 'Incoming' }));
  expect(within(filter).getByRole('button', { name: 'Incoming' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.change(within(filter).getByLabelText('From date'), { target: { value: '2026-09-01' } });
  fireEvent.change(within(filter).getByLabelText('Through date'), { target: { value: '2026-09-02' } });
  expect(within(filter).queryByPlaceholderText('Min')).toBeNull();
  fireEvent.click(within(filter).getByRole('button', { name: 'Apply' }));
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
  const filter = openFilter();
  expect(
    await within(filter).findByText('Wallet filters could not be loaded. Your activity can still be viewed.'),
  ).toBeTruthy();
  expect(within(filter).queryByRole('option', { name: /Primary wallet/ })).toBeNull();
  fireEvent.click(within(filter).getByRole('button', { name: 'Outgoing' }));
  fireEvent.change(within(filter).getByLabelText('From date'), { target: { value: '2026-09-01' } });
  broken = false;
  fireEvent.click(within(filter).getByRole('button', { name: 'Try wallets again' }));
  expect(await within(filter).findByRole('option', { name: /Reserve wallet/ })).toBeTruthy();
  expect(within(filter).getByLabelText('From date')).toHaveProperty('value', '2026-09-01');
  expect(within(filter).getByRole('button', { name: 'Outgoing' }).getAttribute('aria-pressed')).toBe('true');
});

it('rejects an inverted date range before making a filtered request and can clear the draft', async () => {
  show();
  await screen.findByText('Pending');
  const filter = openFilter();
  fireEvent.change(within(filter).getByLabelText('From date'), { target: { value: '2026-09-10' } });
  fireEvent.change(within(filter).getByLabelText('Through date'), { target: { value: '2026-09-01' } });
  expect(within(filter).getByRole('alert').textContent).toContain('must be on or after');
  expect(within(filter).getByRole('button', { name: 'Apply' })).toHaveProperty('disabled', true);
  fireEvent.click(within(filter).getByRole('button', { name: 'Apply' }));
  expect(activityReads()).toHaveLength(1);
  fireEvent.click(within(filter).getByRole('button', { name: 'Clear' }));
  expect(screen.queryByRole('region', { name: /^Filter/ })).toBeNull();
  expect(within(openFilter()).getByLabelText('From date')).toHaveProperty('value', '');
});

it('applies and clears from the open filter, closing it and every open entry and returning focus to Filter', async () => {
  wallets = async () => page([wallet, secondWallet]);
  show();
  const entry = await screen.findByRole('button', { name: entryName });
  fireEvent.click(entry);
  expect(detailOf(entry).hidden).toBe(false);
  expect(filterToggle().textContent).toContain('All transfers');
  const filter = openFilter();
  await within(filter).findByRole('option', { name: /Reserve wallet/ });
  fireEvent.click(within(filter).getByRole('button', { name: 'Incoming' }));
  fireEvent.change(within(filter).getByLabelText('Network'), { target: { value: 'base' } });
  fireEvent.change(within(filter).getByLabelText('Wallet'), { target: { value: 'wallet-two' } });
  fireEvent.change(within(filter).getByLabelText('From date'), { target: { value: '2026-09-01' } });
  fireEvent.change(within(filter).getByLabelText('Through date'), { target: { value: '2026-09-02' } });
  expect(filterToggle().textContent).toContain('All transfers');

  fireEvent.click(within(filter).getByRole('button', { name: 'Apply' }));
  expect(filterToggle().getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(filterToggle());
  expect(filterToggle().textContent).toContain(
    'Incoming · Base · Reserve wallet · 1 September 2026 to 2 September 2026',
  );
  await waitFor(() => expect(activityReads()).toHaveLength(2));
  const filtered = await screen.findByRole('button', { name: entryName });
  expect(filtered.getAttribute('aria-expanded')).toBe('false');
  expect(detailOf(filtered).hidden).toBe(true);

  fireEvent.click(filtered);
  expect(detailOf(filtered).hidden).toBe(false);
  fireEvent.click(within(openFilter()).getByRole('button', { name: 'Clear' }));
  expect(filterToggle().getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(filterToggle());
  expect(filterToggle().textContent).toContain('All transfers');
  const cleared = await screen.findByRole('button', { name: entryName });
  expect(cleared.getAttribute('aria-expanded')).toBe('false');
  expect(detailOf(cleared).hidden).toBe(true);
});

it.each([
  ['start_date', 'From date', 'From 1 September 2026'],
  ['end_date', 'Through date', 'Through 1 September 2026'],
])('names a single %s bound on the closed filter', async (_, field, summary) => {
  show();
  await screen.findByText('Pending');
  const filter = openFilter();
  fireEvent.change(within(filter).getByLabelText(field), { target: { value: '2026-09-01' } });
  fireEvent.click(within(filter).getByRole('button', { name: 'Apply' }));
  expect(filterToggle().textContent).toContain(summary);
});

it('names an applied wallet that is no longer listed as the selected wallet', async () => {
  wallets = async () => page([wallet, secondWallet]);
  show();
  await screen.findByText('Pending');
  const filter = openFilter();
  await within(filter).findByRole('option', { name: /Reserve wallet/ });
  fireEvent.change(within(filter).getByLabelText('Wallet'), { target: { value: 'wallet-two' } });
  fireEvent.click(within(filter).getByRole('button', { name: 'Apply' }));
  expect(filterToggle().textContent).toContain('Reserve wallet');
  wallets = async () => page([wallet]);
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['wallets', 'activity-filter'] });
  });
  await waitFor(() => expect(filterToggle().textContent).toContain('Selected wallet'));
  expect(filterToggle().textContent).not.toContain('Reserve wallet');
  expect(filterToggle().textContent).not.toContain(secondWallet.uuid);
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
  const filter = openFilter();
  fireEvent.click(within(filter).getByRole('button', { name: 'Outgoing' }));
  fireEvent.click(within(filter).getByRole('button', { name: 'Apply' }));
  expect(await screen.findByText('No matching activity.')).toBeTruthy();
  expect(screen.getByRole('heading', { level: 2, name: 'Transfers' })).toBeTruthy();
  expect(screen.queryByText('No activity yet.')).toBeNull();
  const clear = screen.getByRole('button', { name: 'Clear filters' });
  clear.focus();
  fireEvent.click(clear);
  expect(document.activeElement).toBe(filterToggle());
  expect(await screen.findByText('Pending')).toBeTruthy();
  expect(screen.queryByText('No matching activity.')).toBeNull();
});

it('keeps the filter at hand when a filtered read fails, so the filters can be cleared', async () => {
  activity = async (params) => {
    if (params.direction === 'incoming') throw Error('Unavailable');
    return page([transaction]);
  };
  show();
  await screen.findByText('Pending');
  const filter = openFilter();
  fireEvent.click(within(filter).getByRole('button', { name: 'Incoming' }));
  fireEvent.click(within(filter).getByRole('button', { name: 'Apply' }));
  expect(await screen.findByText('Your activity could not be loaded. Try again before continuing.')).toBeTruthy();
  const transfers = screen.getByRole('heading', { level: 2, name: 'Transfers' }).closest('section')!;
  expect(within(transfers).getByRole('alert')).toBeTruthy();
  fireEvent.click(within(openFilter()).getByRole('button', { name: 'Clear' }));
  expect(await screen.findByText('Pending')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
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
  const entry = await screen.findByRole('button', { name: entryName });
  fireEvent.click(entry);
  expect(detailOf(entry).hidden).toBe(false);
  activity = async () => {
    throw Error('Unavailable');
  };
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['transactions'] });
  });
  expect(await screen.findByRole('alert')).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole('button', { name: entryName })).toBeNull());
  expect(screen.queryByText('Pending')).toBeNull();
  expect(screen.queryByText('Recorded')).toBeNull();
  activity = async () => page([{ ...transaction, status: 'confirmed' }]);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  const recovered = await screen.findByRole('button', { name: entryName });
  expect(recovered.getAttribute('aria-expanded')).toBe('true');
  expect(within(detailOf(recovered)).getByText('✓ Confirmed')).toBeTruthy();
});

it('refuses a nonadvancing history page', async () => {
  activity = async () => page([transaction], 'https://example.invalid/api/transactions/?page=1');
  show();
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Your activity could not be loaded. Try again before continuing.',
  );
  expect(screen.queryByText('Pending')).toBeNull();
});

it('opens an entry in place under its row with exact amounts, native network fees, full identities and the explorer', async () => {
  show();
  const entry = await screen.findByRole('button', { name: entryName });
  expect(entry.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(entry);
  const detail = detailOf(entry);
  expect(entry.getAttribute('aria-expanded')).toBe('true');
  expect(detail.hidden).toBe(false);
  expect(screen.queryByRole('region')).toBeNull();
  expect(entry.closest('li')!.contains(detail)).toBe(true);
  expect(within(detail).getByText(transaction.txHash)).toBeTruthy();
  expect(within(detail).getAllByText(transaction.walletAddress)).toHaveLength(2);
  expect(within(detail).getByText(transaction.toAddress!)).toBeTruthy();
  expect(within(detail).getByText('0.000000000000000001 ETH')).toBeTruthy();
  expect(within(detail).getByText('9,007,199,254,740,993.000000000000000001 AUDX')).toBeTruthy();
  expect(within(detail).queryByText('Block time')).toBeNull();
  const explorer = within(detail).getByRole('link', { name: 'View on Explorer' });
  expect(explorer.getAttribute('href')).toBe(getBlockExplorerTxUrl('base', transaction.txHash));
  expect(explorer.getAttribute('target')).toBe('_blank');
  expect(explorer.getAttribute('rel')).toBe('noopener noreferrer');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it.each([
  ['without a transaction hash', { txHash: '' }, false],
  ['on a network with no explorer', { chain: 'solana' }, true],
] as const)('offers no explorer link for an entry %s', async (_, change, hashShown) => {
  activity = async () => page([{ ...transaction, ...change }]);
  show();
  const entry = await screen.findByRole('button', { name: entryName });
  fireEvent.click(entry);
  const detail = detailOf(entry);
  expect(within(detail).getByText('Wallet')).toBeTruthy();
  expect(within(detail).queryByText('Transaction') !== null).toBe(hashShown);
  expect(within(detail).queryByText('View on Explorer')).toBeNull();
});

it('toggles entries from the keyboard and leaves another open entry where it is', async () => {
  const user = userEvent.setup();
  activity = async () => page([transaction, { ...transaction, uuid: 'entry-two', status: 'confirmed' }]);
  show();
  const [first, second] = await screen.findAllByRole('button', { name: entryName });
  first.focus();
  await user.keyboard('{Enter}');
  expect(first.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(first);
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole('link', { name: 'View on Explorer' }));
  await user.tab();
  expect(document.activeElement).toBe(second);
  await user.keyboard(' ');
  expect(second.getAttribute('aria-expanded')).toBe('true');
  expect(first.getAttribute('aria-expanded')).toBe('true');
  expect(detailOf(first).hidden).toBe(false);
  expect(detailOf(second).hidden).toBe(false);
  expect(screen.queryAllByRole('region')).toHaveLength(0);
  await user.keyboard('{Enter}');
  expect(second.getAttribute('aria-expanded')).toBe('false');
  expect(detailOf(second).hidden).toBe(true);
  expect(detailOf(first).hidden).toBe(false);
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
