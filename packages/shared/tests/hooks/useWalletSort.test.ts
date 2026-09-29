/** @jest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';

import { WALLET_SORTS, sortWallets, useWalletSort, type WalletSortOption } from '../../src/hooks/useWalletSort';
import type { Wallet } from '../../src/types';

afterEach(cleanup);

function wallet(uuid: string, fields: Partial<Wallet>): Wallet {
  return {
    uuid,
    name: '',
    address: `0x${uuid.repeat(40)}`,
    chain: 'ethereum',
    verificationStatus: 'VERIFIED',
    signingPreference: 'software',
    nativeBalance: '0',
    marketValue: '0',
    ...fields,
  } as Wallet;
}

const bravo = wallet('a', { name: 'Bravo', marketValue: '5', nativeBalance: '9' });
const unnamed = wallet('b', {
  verificationStatus: 'PENDING',
  signingPreference: 'hardware',
  marketValue: '1',
  nativeBalance: '10',
});
const alpha = wallet('c', { name: 'alpha', verificationStatus: 'PENDING', marketValue: '9', nativeBalance: '0.5' });
const charlie = wallet('d', { name: 'Charlie', signingPreference: 'hardware', marketValue: '12', nativeBalance: '2' });
const WALLETS = [bravo, unnamed, alpha, charlie];

it.each<[WalletSortOption, Wallet[]]>([
  ['default', [unnamed, charlie, bravo, alpha]],
  ['verified', [bravo, charlie, unnamed, alpha]],
  ['name', [unnamed, alpha, bravo, charlie]],
  ['namedFirst', [alpha, bravo, charlie, unnamed]],
  ['highestValue', [charlie, alpha, bravo, unnamed]],
  ['highestBalance', [unnamed, bravo, charlie, alpha]],
])('orders the wallets by %s, leaving the list it was given alone', (option, expected) => {
  const input = [...WALLETS];

  expect(sortWallets(input, option).map((entry) => entry.uuid)).toEqual(expected.map((entry) => entry.uuid));
  expect(input).toEqual(WALLETS);
});

it('compares balances and values as exact decimals, across unsafe integers and subunit fractions', () => {
  const balances = [
    wallet('a', { nativeBalance: '9007199254740992.1' }),
    wallet('b', { nativeBalance: '9007199254740992.2' }),
    wallet('c', { nativeBalance: '0.000000000000000002' }),
    wallet('d', { nativeBalance: '0.000000000000000001' }),
  ];
  expect(sortWallets(balances, 'highestBalance').map((entry) => entry.uuid)).toEqual(['b', 'a', 'c', 'd']);
  const values = balances.map((entry) => ({ ...entry, marketValue: entry.nativeBalance, nativeBalance: '0' }));
  expect(sortWallets(values, 'highestValue').map((entry) => entry.uuid)).toEqual(['b', 'a', 'c', 'd']);
});

it('offers the six orders once each, starting with hardware first', () => {
  expect(WALLET_SORTS.map((option) => [option.id, option.label])).toEqual([
    ['default', 'Hardware first'],
    ['verified', 'Verified first'],
    ['name', 'Name, A to Z'],
    ['namedFirst', 'Named first'],
    ['highestValue', 'Highest value'],
    ['highestBalance', 'Highest balance'],
  ]);
});

it('keeps each chain its own order and its own open sort, closing only the chain an order is chosen for', () => {
  const { result } = renderHook(() => useWalletSort());
  expect(result.current.sortOf('ethereum')).toBe('default');
  expect(result.current.isOpen('ethereum')).toBe(false);

  act(() => {
    result.current.toggle('ethereum');
    result.current.toggle('base');
  });
  expect(result.current.isOpen('ethereum')).toBe(true);
  expect(result.current.isOpen('base')).toBe(true);

  act(() => result.current.choose('ethereum', 'highestBalance'));
  expect(result.current.sortOf('ethereum')).toBe('highestBalance');
  expect(result.current.isOpen('ethereum')).toBe(false);
  expect(result.current.sortOf('base')).toBe('default');
  expect(result.current.isOpen('base')).toBe(true);

  act(() => result.current.choose('base', 'name'));
  expect(result.current.sortOf('base')).toBe('name');
  expect(result.current.isOpen('base')).toBe(false);
  expect(result.current.sortOf('ethereum')).toBe('highestBalance');

  act(() => result.current.toggle('ethereum'));
  expect(result.current.isOpen('ethereum')).toBe(true);
  act(() => result.current.toggle('ethereum'));
  expect(result.current.isOpen('ethereum')).toBe(false);
  expect(result.current.sortOf('ethereum')).toBe('highestBalance');
});
