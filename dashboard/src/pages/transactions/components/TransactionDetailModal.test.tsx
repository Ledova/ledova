// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Transaction } from '@ledova/shared';
import { TransactionDetailModal } from './TransactionDetailModal';

afterEach(cleanup);

const transaction: Transaction = {
  uuid: 'synthetic-transaction',
  createdAt: '2026-09-01T10:00:00Z',
  txHash: '0x' + '17'.repeat(32),
  chain: 'base',
  fromAddress: '0x' + 'ab'.repeat(20),
  toAddress: '0x' + 'cd'.repeat(20),
  walletAddress: '0x' + 'ab'.repeat(20),
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
  ['confirmed', '✓ Confirmed'],
  ['pending', 'Pending'],
  ['failed', '✗ Failed'],
  ['replaced', 'Replaced'],
  ['reorged', 'Confirmation reversed'],
  ['constructor', 'Unknown'],
] as const)('displays a %s transaction as %s', (status, label) => {
  const view = render(
    <TransactionDetailModal
      isOpen
      transaction={Object.assign({ ...transaction }, { status })}
      onClose={() => {}}
      onViewExplorer={() => {}}
    />,
  );
  expect(view.getByText(label)).toBeTruthy();
  if (status !== 'failed') expect(view.queryByText('✗ Failed')).toBeNull();
});
