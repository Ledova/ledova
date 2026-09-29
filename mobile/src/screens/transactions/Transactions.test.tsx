import React from 'react';
import { AccessibilityInfo, Linking } from 'react-native';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TRANSACTION_ENDPOINTS, WALLET_ENDPOINTS, getBlockExplorerTxUrl } from '@ledova/shared';
import type { Transaction } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { TransactionsScreen } from './index';

jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn() } }));
jest.mock('../../components/date-picker', () => {
  const { TextInput } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    DatePickerField: ({ label, onChange }: { label: string; onChange: (date: Date | undefined) => void }) => (
      <TextInput
        accessibilityLabel={label}
        onChangeText={(value: string) => onChange(value ? new Date(`${value}T12:00:00`) : undefined)}
      />
    ),
  };
});
jest.mock('react-native-element-dropdown', () => {
  const { View, Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Dropdown: ({
      data,
      onChange,
      disable,
    }: {
      data: { value: string; label: string }[];
      onChange: (item: { value: string; label: string }) => void;
      disable: boolean;
    }) => (
      <View>
        {data.map((item) => (
          <Pressable key={item.value} accessibilityRole="button" disabled={disable} onPress={() => onChange(item)}>
            <Text>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    ),
  };
});
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
const entryName = /^Outgoing · Example settlement asset/;
function page<T>(results: T[], next: string | null = null) {
  return { data: { results, next, previous: null, count: results.length } };
}
let client: QueryClient;
let activity: (params: Record<string, unknown>) => Promise<unknown>;
let wallets: (params: Record<string, unknown>) => Promise<unknown>;
const reads = () => jest.mocked(apiClient.get).mock.calls.filter(([url]) => url === TRANSACTION_ENDPOINTS.BASE);
const show = () =>
  render(
    <QueryClientProvider client={client}>
      <TransactionsScreen />
    </QueryClientProvider>,
  );
type Screen = Awaited<ReturnType<typeof show>>;
type Element = ReturnType<Screen['getByText']>;
const filterToggle = (view: Screen) => view.getByRole('button', { name: /^Filter/ });
const detailOf = (row: Element) => (row.parent!.children as Element[])[1];
async function openFilter(view: Screen) {
  await fireEvent.press(filterToggle(view));
  expect(filterToggle(view)).toBeExpanded();
  return detailOf(filterToggle(view));
}
const focusMoves = (view: Screen) =>
  jest
    .mocked(AccessibilityInfo.sendAccessibilityEvent)
    .mock.calls.map(([target, event]) => [
      (target as unknown as Element).props.onClick === filterToggle(view).props.onClick ? 'Filter' : 'elsewhere',
      event,
    ]);
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  activity = async () => page([transaction]);
  wallets = async () => page([wallet]);
  jest.mocked(apiClient.get).mockImplementation(async (url, config) => {
    if (url === TRANSACTION_ENDPOINTS.BASE) return activity((config?.params ?? {}) as Record<string, unknown>);
    if (url === WALLET_ENDPOINTS.BASE) return wallets((config?.params ?? {}) as Record<string, unknown>);
    throw Error(`Unexpected read ${url}`);
  });
});
afterEach(async () => {
  await cleanup();
  client.clear();
});

it('reads exact activity independently of an empty wallet list and leaves Notices to the drawer', async () => {
  wallets = async () => page([]);
  const view = await show();
  expect(await view.findByText('9,007,199,254,740,993.000000000000000001 AUDX')).toBeTruthy();
  expect(view.getByText('Pending')).toBeTruthy();
  expect(reads()).toHaveLength(1);
  expect(view.queryByText('Open Notices')).toBeNull();
});
it('opens the filter in place at the top of Transfers, closed by default, with no screen action or dialog', async () => {
  const view = await show();
  await view.findByText('Pending');
  expect(within(view.getByRole('header', { name: 'Activity' }).parent!).queryAllByRole('button')).toHaveLength(0);
  const transfers = view.getByRole('header', { name: 'Transfers' }).parent!;
  const toggle = within(transfers).getByRole('button', { name: /^Filter/ });
  expect((transfers.children as Element[])[1]).toBe(toggle.parent!.parent);
  expect(toggle).toBeCollapsed();
  expect(view.queryByRole('radio', { name: 'Direction: Incoming' })).toBeNull();
  expect(view.queryByText('Apply')).toBeNull();

  await fireEvent.press(toggle);
  expect(toggle).toBeExpanded();
  const filter = detailOf(toggle);
  expect(within(filter).getByRole('radio', { name: 'Direction: Incoming' })).toBeTruthy();
  expect(within(filter).getByRole('radio', { name: 'Network: Base' })).toBeTruthy();
  expect(within(filter).getByText('Primary wallet · ' + wallet.address)).toBeTruthy();
  expect(within(filter).getByLabelText('From date')).toBeTruthy();
  expect(within(filter).getByLabelText('Through date')).toBeTruthy();
  expect(within(filter).getByRole('button', { name: 'Clear filters' })).toBeTruthy();
  expect(within(filter).getByRole('button', { name: 'Apply' })).toBeTruthy();
  expect(view.queryByText('Filter activity')).toBeNull();

  await fireEvent.press(toggle);
  expect(toggle).toBeCollapsed();
  expect(view.queryByRole('radio', { name: 'Direction: Incoming' })).toBeNull();
});
it('keeps history usable while wallet filters are still loading', async () => {
  let finish!: (value: unknown) => void;
  wallets = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const view = await show();
  expect(await view.findByText('Pending')).toBeTruthy();
  const filter = await openFilter(view);
  expect(within(filter).getByText('Loading wallets…')).toBeTruthy();
  await act(async () => finish(page([wallet])));
  await waitFor(() => expect(view.queryByText('Loading wallets…')).toBeNull());
});
it('loads all wallet pages separately from legacy caches and applies supported local-day filters', async () => {
  client.setQueryData(['wallets'], page([wallet]));
  wallets = async (params) =>
    params.page === 1 ? page([wallet], 'https://example.invalid/api/wallets/?page=2') : page([secondWallet]);
  const view = await show();
  await view.findByText('Pending');
  await openFilter(view);
  await waitFor(() => expect(client.getQueryData(['wallets', 'activity-filter'])).toEqual([wallet, secondWallet]));
  await fireEvent.press(await view.findByText(`Reserve wallet · ${secondWallet.address}`));
  await fireEvent.press(view.getByRole('radio', { name: 'Direction: Incoming' }));
  await fireEvent.press(view.getByRole('radio', { name: 'Network: Base' }));
  await fireEvent.changeText(view.getByLabelText('From date'), '2026-09-01');
  await fireEvent.changeText(view.getByLabelText('Through date'), '2026-09-02');
  await fireEvent.press(view.getByText('Apply'));
  await waitFor(() =>
    expect(reads().at(-1)?.[1]?.params).toEqual({
      wallet: secondWallet.uuid,
      direction: 'incoming',
      chain: 'base',
      start_date: new Date('2026-09-01T00:00:00').toISOString(),
      end_date: new Date('2026-09-02T23:59:59.999').toISOString(),
      page: 1,
    }),
  );
  expect(client.getQueryData(['wallets'])).toEqual(page([wallet]));
});
it('keeps filter drafts through failed wallet pagination and retries without losing history', async () => {
  wallets = async (params) => {
    if (params.page === 2) throw Error('offline');
    return page([wallet], 'https://example.invalid/api/wallets/?page=2');
  };
  const view = await show();
  await view.findByText('Pending');
  await openFilter(view);
  expect(await view.findByText('Wallet filters could not be loaded. Your activity can still be viewed.')).toBeTruthy();
  await fireEvent.press(view.getByRole('radio', { name: 'Direction: Incoming' }));
  wallets = async () => page([secondWallet]);
  await fireEvent.press(view.getByText('Try wallets again'));
  await waitFor(() =>
    expect(view.queryByText('Wallet filters could not be loaded. Your activity can still be viewed.')).toBeNull(),
  );
  expect(view.getByRole('radio', { name: 'Direction: Incoming' }).props.accessibilityState.checked).toBe(true);
  await fireEvent.press(view.getByText('Apply'));
  await waitFor(() => expect((reads().at(-1)?.[1]?.params as Record<string, unknown>)?.direction).toBe('incoming'));
});
it('rejects reversed date ranges before querying and clears the draft', async () => {
  const view = await show();
  await view.findByText('Pending');
  await openFilter(view);
  await fireEvent.changeText(view.getByLabelText('From date'), '2026-09-03');
  await fireEvent.changeText(view.getByLabelText('Through date'), '2026-09-01');
  expect(view.getByText('The through date must be on or after the from date.')).toBeTruthy();
  await fireEvent.press(view.getByText('Apply'));
  expect(reads()).toHaveLength(1);
  await fireEvent.press(view.getByText('Clear filters'));
  expect(filterToggle(view)).toBeCollapsed();
  const filter = await openFilter(view);
  expect(within(filter).queryByText('The through date must be on or after the from date.')).toBeNull();
  expect(within(filter).getByRole('button', { name: 'Apply' })).toBeEnabled();
});
it('names the filters it applies on the closed filter, and a wallet no longer listed as the selected wallet', async () => {
  wallets = async () => page([wallet, secondWallet]);
  const view = await show();
  await view.findByText('Pending');
  expect(within(filterToggle(view)).getByText('All transfers')).toBeTruthy();
  await openFilter(view);
  await fireEvent.press(await view.findByText(`Reserve wallet · ${secondWallet.address}`));
  await fireEvent.press(view.getByRole('radio', { name: 'Direction: Incoming' }));
  await fireEvent.press(view.getByRole('radio', { name: 'Network: Base' }));
  await fireEvent.changeText(view.getByLabelText('From date'), '2026-09-01');
  await fireEvent.changeText(view.getByLabelText('Through date'), '2026-09-02');
  expect(within(filterToggle(view)).getByText('All transfers')).toBeTruthy();
  await fireEvent.press(view.getByText('Apply'));
  const applied = 'Incoming · Base · Reserve wallet · 1 September 2026 to 2 September 2026';
  expect(within(filterToggle(view)).getByText(applied)).toBeTruthy();

  wallets = async () => page([wallet]);
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['wallets', 'activity-filter'] });
  });
  await waitFor(() =>
    expect(
      within(filterToggle(view)).getByText('Incoming · Base · Selected wallet · 1 September 2026 to 2 September 2026'),
    ).toBeTruthy(),
  );
  expect(view.queryByText(/Reserve wallet/)).toBeNull();
});
it.each([
  ['From date', 'From 1 September 2026'],
  ['Through date', 'Through 1 September 2026'],
])('names a single %s bound on the closed filter', async (field, summary) => {
  const view = await show();
  await view.findByText('Pending');
  await openFilter(view);
  await fireEvent.changeText(view.getByLabelText(field), '2026-09-01');
  await fireEvent.press(view.getByText('Apply'));
  expect(within(filterToggle(view)).getByText(summary)).toBeTruthy();
});
it('applies and clears from the open filter, closing it and every open entry and returning focus to Filter', async () => {
  const view = await show();
  const entry = await view.findByRole('button', { name: entryName });
  await fireEvent.press(entry);
  expect(entry).toBeExpanded();
  await openFilter(view);
  await fireEvent.press(view.getByRole('radio', { name: 'Direction: Incoming' }));
  expect(focusMoves(view)).toEqual([]);

  await fireEvent.press(view.getByRole('button', { name: 'Apply' }));
  expect(filterToggle(view)).toBeCollapsed();
  expect(view.queryByRole('radio', { name: 'Direction: Incoming' })).toBeNull();
  expect(focusMoves(view)).toEqual([['Filter', 'focus']]);
  await waitFor(() => expect((reads().at(-1)?.[1]?.params as Record<string, unknown>)?.direction).toBe('incoming'));
  const filtered = await view.findByRole('button', { name: entryName });
  expect(filtered).toBeCollapsed();
  expect(view.queryByText('Recorded')).toBeNull();

  await fireEvent.press(filtered);
  expect(filtered).toBeExpanded();
  const filter = await openFilter(view);
  await fireEvent.press(within(filter).getByRole('button', { name: 'Clear filters' }));
  expect(filterToggle(view)).toBeCollapsed();
  expect(focusMoves(view)).toEqual([
    ['Filter', 'focus'],
    ['Filter', 'focus'],
  ]);
  expect(within(filterToggle(view)).getByText('All transfers')).toBeTruthy();
  const cleared = await view.findByRole('button', { name: entryName });
  expect(cleared).toBeCollapsed();
  expect(view.queryByText('Recorded')).toBeNull();
});
it('distinguishes loading from an empty history', async () => {
  let finish!: (value: unknown) => void;
  activity = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const view = await show();
  expect(view.getByText('Loading activity…')).toBeTruthy();
  expect(view.queryByText('No activity yet.')).toBeNull();
  await act(async () => finish(page([])));
  expect(await view.findByText('No activity yet.')).toBeTruthy();
  expect(view.getByText('Transfers')).toBeTruthy();
});
it('keeps the Transfers title when filters match nothing and clears them from that state', async () => {
  activity = async (params) => page(params.direction === 'outgoing' ? [] : [transaction]);
  const view = await show();
  await view.findByText('Pending');
  await openFilter(view);
  await fireEvent.press(view.getByRole('radio', { name: 'Direction: Outgoing' }));
  await fireEvent.press(view.getByText('Apply'));
  expect(await view.findByText('No matching activity.')).toBeTruthy();
  expect(view.getByText('Transfers')).toBeTruthy();
  expect(view.queryByText('No activity yet.')).toBeNull();
  await fireEvent.press(view.getByText('Clear filters'));
  expect(focusMoves(view)).toEqual([
    ['Filter', 'focus'],
    ['Filter', 'focus'],
  ]);
  expect(await view.findByText('Pending')).toBeTruthy();
  expect(view.queryByText('No matching activity.')).toBeNull();
});
it('keeps the filter at hand when a filtered read fails, so the filters can be cleared', async () => {
  activity = async (params) => {
    if (params.direction === 'incoming') throw Error('offline');
    return page([transaction]);
  };
  const view = await show();
  await view.findByText('Pending');
  await openFilter(view);
  await fireEvent.press(view.getByRole('radio', { name: 'Direction: Incoming' }));
  await fireEvent.press(view.getByText('Apply'));
  expect(await view.findByText('Your activity could not be loaded. Try again before continuing.')).toBeTruthy();
  const transfers = view.getByRole('header', { name: 'Transfers' }).parent!;
  expect(within(transfers).getByRole('alert')).toBeTruthy();
  expect(within(filterToggle(view)).getByText('Incoming')).toBeTruthy();
  const filter = await openFilter(view);
  await fireEvent.press(within(filter).getByRole('button', { name: 'Clear filters' }));
  expect(await view.findByText('Pending')).toBeTruthy();
  expect(view.queryByText('Your activity could not be loaded. Try again before continuing.')).toBeNull();
});
it('retries an initial history failure without claiming no records', async () => {
  activity = async () => {
    throw Error('offline');
  };
  const view = await show();
  expect(await view.findByText('Your activity could not be loaded. Try again before continuing.')).toBeTruthy();
  expect(view.queryByText('No activity yet.')).toBeNull();
  activity = async () => page([transaction]);
  await fireEvent.press(view.getByText('Try again'));
  expect(await view.findByText('Pending')).toBeTruthy();
});
it('marks a failed later page incomplete, retains known rows and retries that page', async () => {
  activity = async (params) => {
    if (params.page === 2) throw Error('offline');
    return page([transaction], 'https://example.invalid/api/transactions/?page=2');
  };
  const view = await show();
  await fireEvent.press(await view.findByText('Load more activity'));
  expect(await view.findByText('More activity could not be loaded. The list is incomplete.')).toBeTruthy();
  expect(view.getByText('Pending')).toBeTruthy();
  activity = async () => page([{ ...transaction, uuid: 'entry-two', status: 'confirmed' }]);
  await fireEvent.press(view.getByText('Try more activity again'));
  expect(await view.findByText('✓ Confirmed')).toBeTruthy();
  expect(view.getByText('Pending')).toBeTruthy();
  expect((reads().at(-1)?.[1]?.params as Record<string, unknown>)?.page).toBe(2);
});
it('does not report an empty first page as complete when another page exists', async () => {
  activity = async (params) =>
    params.page === 1 ? page([], 'https://example.invalid/api/transactions/?page=2') : page([transaction]);
  const view = await show();
  await fireEvent.press(await view.findByText('Load more activity'));
  expect(view.queryByText('No activity yet.')).toBeNull();
  expect(await view.findByText('Pending')).toBeTruthy();
});
it('rejects a non-advancing history link', async () => {
  activity = async () => page([transaction], 'https://example.invalid/api/transactions/?page=1');
  const view = await show();
  expect(await view.findByText('Your activity could not be loaded. Try again before continuing.')).toBeTruthy();
  expect(view.queryByText('Pending')).toBeNull();
});
it('refreshes actual records and hides a stale open detail on failure, then restores current status', async () => {
  const view = await show();
  const entry = await view.findByRole('button', { name: entryName });
  await fireEvent.press(entry);
  expect(within(detailOf(entry)).getByText('Recorded')).toBeTruthy();
  activity = async () => {
    throw Error('offline');
  };
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['all-transactions'] });
  });
  expect(await view.findByText('Your activity could not be loaded. Try again before continuing.')).toBeTruthy();
  expect(view.queryByText('Recorded')).toBeNull();
  expect(view.queryByRole('button', { name: entryName })).toBeNull();
  activity = async () => page([{ ...transaction, status: 'reorged' }]);
  await fireEvent.press(view.getByText('Try again'));
  const recovered = await view.findByRole('button', { name: entryName });
  expect(recovered).toBeExpanded();
  expect(within(detailOf(recovered)).getByText('Confirmation reversed')).toBeTruthy();
});
it('opens entries in place under their own rows, each on its own', async () => {
  activity = async () => page([transaction, { ...transaction, uuid: 'entry-two', status: 'confirmed' }]);
  const view = await show();
  const [first, second] = await view.findAllByRole('button', { name: entryName });
  expect(first).toBeCollapsed();
  expect(second).toBeCollapsed();
  expect(view.queryByText('Recorded')).toBeNull();

  await fireEvent.press(first);
  expect(first).toBeExpanded();
  expect(second).toBeCollapsed();
  expect(within(detailOf(first)).getByText('Recorded')).toBeTruthy();
  expect(detailOf(second).children).toHaveLength(0);

  await fireEvent.press(second);
  expect(first).toBeExpanded();
  expect(second).toBeExpanded();
  expect(within(detailOf(second)).getByText('✓ Confirmed')).toBeTruthy();
  expect(within(detailOf(first)).getByText('Pending')).toBeTruthy();

  await fireEvent.press(second);
  expect(second).toBeCollapsed();
  expect(detailOf(second).children).toHaveLength(0);
  expect(first).toBeExpanded();
  expect(within(detailOf(first)).getByText('Recorded')).toBeTruthy();
  expect(view.queryByText('Activity detail')).toBeNull();
});
it('shows exact details and native-unit fees, opens the real explorer URL and reports a refused open', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockRejectedValueOnce(Error('refused')).mockResolvedValue(undefined);
  const view = await show();
  const entry = await view.findByRole('button', { name: entryName });
  await fireEvent.press(entry);
  const detail = detailOf(entry);
  expect(within(detail).getByText('0.000000000000000001 ETH')).toBeTruthy();
  expect(within(detail).getByText('9,007,199,254,740,993.000000000000000001 AUDX')).toBeTruthy();
  expect(within(detail).getAllByText(wallet.address)).toHaveLength(2);
  expect(within(detail).getByText(transaction.txHash)).toBeTruthy();
  await fireEvent.press(within(detail).getByText('View on Explorer'));
  expect(await within(detail).findByText('The explorer could not be opened. Try again.')).toBeTruthy();
  expect(open).toHaveBeenCalledWith(getBlockExplorerTxUrl('base', transaction.txHash));
  await fireEvent.press(within(detail).getByText('View on Explorer'));
  await waitFor(() => expect(view.queryByText('The explorer could not be opened. Try again.')).toBeNull());
});

it.each([
  ['base', '0xAbCd', '0xOther', '0xabcd', 'Incoming'],
  ['base', '0xAbCd', '0xabcd', '0xABCD', 'Self transfer'],
  ['solana', 'AbCd', 'ABCD', 'other', 'Direction unavailable'],
  ['bitcoin', '1AbCd', '1abcd', 'other', 'Direction unavailable'],
  ['bitcoin', 'tb1ABCD', 'tb1abcd', 'other', 'Outgoing'],
])('uses %s address identity for %s, %s and %s', async (chain, walletAddress, fromAddress, toAddress, direction) => {
  activity = async () => page([{ ...transaction, chain, walletAddress, fromAddress, toAddress }]);
  const view = await show();
  expect(await view.findByText(`${direction} · Example settlement asset`)).toBeTruthy();
});

it('keeps zero amounts exact and omits explorer actions when there is no transaction hash', async () => {
  activity = async () =>
    page([{ ...transaction, amount: '0.000', txHash: '', transactionFee: '0.000', status: 'failed' }]);
  const view = await show();
  await fireEvent.press(await view.findByRole('button', { name: entryName }));
  expect(view.getAllByText('0 AUDX').length).toBeGreaterThan(0);
  expect(view.getByText('0 ETH')).toBeTruthy();
  expect(view.queryByText('View on Explorer')).toBeNull();
});

it.each([
  ['-0.5', '-0.5 AUDX'],
  ['-0.000000000000000001', '-0.000000000000000001 AUDX'],
  ['-1000.50', '-1,000.5 AUDX'],
  ['0.0000', '0 AUDX'],
])('preserves the recorded sign and precision of %s', async (amount, expected) => {
  activity = async () => page([{ ...transaction, amount }]);
  const view = await show();
  expect(await view.findByText(expected)).toBeTruthy();
});
