import type { Transaction } from '../../src/types';
import { activityAmount, activityDirection, activityStatus, feeUnit } from '../../src/utils/activity';

const transaction: Transaction = {
  uuid: 'synthetic-transaction',
  createdAt: '2026-09-01T10:00:00Z',
  txHash: `0x${'17'.repeat(32)}`,
  chain: 'base',
  fromAddress: `0x${'ab'.repeat(20)}`,
  toAddress: `0x${'cd'.repeat(20)}`,
  walletAddress: `0x${'ab'.repeat(20)}`,
  wallet: 'synthetic-wallet',
  asset: 'synthetic-asset',
  assetSymbol: 'ETH',
  assetName: 'Ethereum',
  amount: '2',
  marketValue: null,
  blockTimestamp: null,
  blockNumber: null,
  status: 'pending',
  transactionFee: null,
  transactionFeeEstimated: null,
};

it.each([
  ['9007199254740993.000000000000000001', '9,007,199,254,740,993.000000000000000001 AUDX'],
  ['-0.5', '-0.5 AUDX'],
  ['-0.000000000000000001', '-0.000000000000000001 AUDX'],
  ['-1000.50', '-1,000.5 AUDX'],
  ['0.0000', '0 AUDX'],
  ['0.000', '0 AUDX'],
])('preserves the recorded sign and precision of %s', (amount, expected) => {
  expect(activityAmount(amount, 'AUDX')).toBe(expected);
});

it('writes an amount without a unit when the record names none', () => {
  expect(activityAmount('1000', '')).toBe('1,000');
});

it.each([null, '', '1e3', '1.', '.5', '1,000', '0x10'])('calls %j unavailable instead of guessing', (amount) => {
  expect(activityAmount(amount, 'AUDX')).toBe('Unavailable');
});

it.each([
  ['base', '0xAbC', '0xabc', '0xdef', 'Outgoing'],
  ['base', '0xAbC', '0xdef', '0xabc', 'Incoming'],
  ['base', '0xAbCd', '0xOther', '0xabcd', 'Incoming'],
  ['base', '0xAbC', '0xABC', '0xabc', 'Self transfer'],
  ['base', '0xAbCd', '0xabcd', '0xABCD', 'Self transfer'],
  ['base', '0xAbC', '0xdef', '0x123', 'Direction unavailable'],
  ['base', '', '0xdef', null, 'Direction unavailable'],
  ['bitcoin', '1Example', '1example', '1Other', 'Direction unavailable'],
  ['bitcoin', '1AbCd', '1abcd', 'other', 'Direction unavailable'],
  ['bitcoin', 'bc1EXAMPLE', 'bc1example', 'bc1other', 'Outgoing'],
  ['bitcoin', 'tb1ABCD', 'tb1abcd', 'other', 'Outgoing'],
  ['bitcoin', 'bcrt1ABCD', 'other', 'bcrt1abcd', 'Incoming'],
  ['solana', 'ExampleWallet', 'examplewallet', 'OtherWallet', 'Direction unavailable'],
  ['solana', 'AbCd', 'ABCD', 'other', 'Direction unavailable'],
  ['solana', 'AbCd', 'AbCd', 'other', 'Outgoing'],
] as const)(
  'uses %s address identity for wallet %j, from %j and to %j',
  (chain, walletAddress, fromAddress, toAddress, direction) => {
    expect(activityDirection({ ...transaction, chain, walletAddress, fromAddress, toAddress })).toBe(direction);
  },
);

it.each([
  ['confirmed', 'Confirmed', '✓ Confirmed'],
  ['failed', 'Failed', '✗ Failed'],
  ['pending', 'Pending', 'Pending'],
  ['reorged', 'Confirmation reversed', 'Confirmation reversed'],
  ['unrecognized', 'Unknown', 'Unknown'],
] as const)('reads a %s status as %j and shows it as %j', (status, label, text) => {
  expect(activityStatus(Object.assign({ ...transaction }, { status }))).toEqual({ label, text });
});

it.each([
  ['base', 'ETH'],
  ['ethereum', 'ETH'],
  ['arbitrum', 'ETH'],
  ['optimism', 'ETH'],
  ['bitcoin', 'BTC'],
  ['solana', 'native units'],
  ['polygon', 'native units'],
] as const)('names %s network fees in %s', (chain, unit) => {
  expect(feeUnit(chain)).toBe(unit);
});
