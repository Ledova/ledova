import { expect, it } from 'vitest';
import type { Wallet } from '@ledova/shared';
import { WALLET_SORTS, sortWallets, type WalletSortOption } from './useWalletSort';

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
])('orders the wallets by %s', (option, expected) => {
  const input = [...WALLETS];

  expect(sortWallets(input, option).map((entry) => entry.uuid)).toEqual(expected.map((entry) => entry.uuid));
  expect(input).toEqual(WALLETS);
});

it('offers every order once, starting with hardware first', () => {
  expect(WALLET_SORTS.map((option) => option.id)).toEqual([
    'default',
    'verified',
    'name',
    'namedFirst',
    'highestValue',
    'highestBalance',
  ]);
  expect(WALLET_SORTS[0].label).toBe('Hardware first');
});
