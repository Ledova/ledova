import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WalletsScreen } from './index';
import { apiClient } from '../../services/apiClient';

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn() } }));
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  useUserPreferences: () => ({ userAccount: { uuid: 'owner' }, isLoading: false, isError: false }),
  useCurrency: () => ({ formatDisplayCurrency: (value: number) => `AUD ${value}` }),
}));

function wallet(uuid: string, chain: string, name: string, marketValue: string, signingPreference = 'software') {
  return {
    uuid,
    chain,
    name,
    marketValue,
    signingPreference,
    userAccount: 'owner',
    address: `0x${uuid.repeat(40)}`,
    verificationStatus: 'VERIFIED',
    lastSyncedAt: null,
    nativeBalance: '0',
    nativeMarketValue: '0',
  };
}

const WALLETS = [
  wallet('b', 'ethereum', 'Bravo', '5'),
  wallet('a', 'ethereum', 'alpha', '1', 'hardware'),
  wallet('c', 'ethereum', '', '9'),
  wallet('d', 'base', 'Zulu', '3', 'hardware'),
  wallet('e', 'base', 'Yankee', '7'),
  wallet('f', 'bitcoin', 'Only coin', '2'),
];
const ORDERS = ['Hardware first', 'Verified first', 'Name, A to Z', 'Named first', 'Highest value', 'Highest balance'];
let client: QueryClient;
let view: Awaited<ReturnType<typeof render>>;

const card = (title: string) => view.getByRole('header', { name: title }).parent!;
const sortOf = (title: string) => within(card(title)).getByRole('button', { name: /^Sort / });
const rows = (title: string) =>
  within(card(title))
    .getAllByRole('button', { name: /^Open wallet / })
    .map((row) => row.props.accessibilityLabel.replace('Open wallet ', ''));

beforeEach(async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  jest.mocked(apiClient.get).mockResolvedValue({
    data: { results: WALLETS, count: WALLETS.length, next: null, previous: null },
  });
  view = await render(
    <QueryClientProvider client={client}>
      <WalletsScreen />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(view.getByText('Bravo')).toBeTruthy());
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

it('sorts a chain in place from the top of its card, naming the order, with no Filter action or dialog', async () => {
  expect(view.queryByRole('button', { name: /^Filter/ })).toBeNull();
  expect(within(card('Bitcoin')).queryByRole('button', { name: /^Sort / })).toBeNull();
  const sort = sortOf('Ethereum');
  expect(sort.props.accessibilityState).toMatchObject({ expanded: false });
  expect(within(sort).getByText('Hardware first')).toBeTruthy();
  expect(card('Ethereum').children.indexOf(sort.parent!.parent!)).toBe(1);
  expect(rows('Ethereum')).toEqual(['alpha', 'Bravo', WALLETS[2].address]);

  await fireEvent.press(sort);

  expect(sortOf('Ethereum').props.accessibilityState).toMatchObject({ expanded: true });
  const orders = ORDERS.map((order) => within(card('Ethereum')).getByRole('button', { name: order }));
  expect(orders.map((order) => order.props.accessibilityState.selected)).toEqual(ORDERS.map((_, index) => index === 0));
  expect(view.queryByRole('header', { name: 'Sort Wallets' })).toBeNull();

  await fireEvent.press(within(card('Ethereum')).getByRole('button', { name: 'Name, A to Z' }));

  expect(sortOf('Ethereum').props.accessibilityState).toMatchObject({ expanded: false });
  const focused = jest
    .mocked(AccessibilityInfo.sendAccessibilityEvent)
    .mock.calls.map(([target, event]) => [(target as unknown as { props: Record<string, unknown> }).props, event]);
  expect(focused).toEqual([
    [expect.objectContaining({ accessibilityRole: 'button', accessibilityState: { expanded: false } }), 'focus'],
  ]);
  expect(within(sortOf('Ethereum')).getByText('Name, A to Z')).toBeTruthy();
  expect(rows('Ethereum')).toEqual([WALLETS[2].address, 'alpha', 'Bravo']);
  expect(rows('Base')).toEqual(['Zulu', 'Yankee']);
  expect(within(sortOf('Base')).getByText('Hardware first')).toBeTruthy();

  await fireEvent.press(sortOf('Base'));
  await fireEvent.press(within(card('Base')).getByRole('button', { name: 'Highest value' }));
  expect(rows('Base')).toEqual(['Yankee', 'Zulu']);
  expect(rows('Ethereum')).toEqual([WALLETS[2].address, 'alpha', 'Bravo']);

  await fireEvent.press(sortOf('Ethereum'));
  expect(within(card('Ethereum')).getByRole('button', { name: 'Name, A to Z' }).props.accessibilityState).toMatchObject(
    { selected: true },
  );
});

it('keeps the order when the sort is closed without choosing one', async () => {
  await fireEvent.press(sortOf('Ethereum'));
  await fireEvent.press(sortOf('Ethereum'));

  expect(sortOf('Ethereum').props.accessibilityState).toMatchObject({ expanded: false });
  expect(within(sortOf('Ethereum')).getByText('Hardware first')).toBeTruthy();
  expect(rows('Ethereum')).toEqual(['alpha', 'Bravo', WALLETS[2].address]);
  expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
});
