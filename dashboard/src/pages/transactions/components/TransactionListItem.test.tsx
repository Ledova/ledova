// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Transaction } from '@ledova/shared';
import { TransactionListItem } from './TransactionListItem';

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

function detailOf(entry: Transaction) {
  render(<TransactionListItem transaction={entry} open onToggle={() => {}} />);
  const detail = document.getElementById(screen.getByRole('button').getAttribute('aria-controls')!)!;
  expect(detail.hidden).toBe(false);
  expect(screen.queryByRole('region')).toBeNull();
  return detail;
}

it('shows no detail while closed and hands the entry to its toggle', () => {
  const toggle = vi.fn();
  render(<TransactionListItem transaction={transaction} open={false} onToggle={toggle} />);
  const row = screen.getByRole('button', { name: /Outgoing · Ethereum/ });
  expect(row.getAttribute('aria-expanded')).toBe('false');
  expect(document.getElementById(row.getAttribute('aria-controls')!)!.hidden).toBe(true);
  expect(screen.queryByText('Recorded')).toBeNull();
  fireEvent.click(row);
  expect(toggle).toHaveBeenCalledExactlyOnceWith(transaction);
});

it.each([
  ['confirmed', '✓ Confirmed'],
  ['pending', 'Pending'],
  ['failed', '✗ Failed'],
  ['replaced', 'Replaced'],
  ['reorged', 'Confirmation reversed'],
  ['constructor', 'Unknown'],
] as const)('displays a %s transaction as %s in its opened detail', (status, label) => {
  const detail = detailOf(Object.assign({ ...transaction }, { status }));
  expect(within(detail).getByText(label)).toBeTruthy();
  if (status !== 'failed') expect(within(detail).queryByText('✗ Failed')).toBeNull();
});

it('names the direction in its opened detail', () => {
  const detail = detailOf({ ...transaction, toAddress: '0x' + 'AB'.repeat(20) });
  expect(within(detail).getByText('Self transfer')).toBeTruthy();
});
