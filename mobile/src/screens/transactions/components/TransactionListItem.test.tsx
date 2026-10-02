import { fireEvent, render, within } from '@testing-library/react-native';
import type { Transaction } from '@ledova/shared';
import { TransactionListItem } from './TransactionListItem';

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
  shareClass: null,
  marketValue: null,
  blockNumber: null,
  status: 'pending',
  transactionFee: null,
  transactionFeeEstimated: null,
  amount: '2',
  blockTimestamp: '2026-09-01T10:00:00Z',
};

async function opened(entry: Transaction) {
  const view = await render(<TransactionListItem transaction={entry} open onToggle={() => {}} />);
  const row = view.getByRole('button', { expanded: true });
  expect(row).toBeExpanded();
  return { view, detail: (row.parent!.children as (typeof row)[])[1] };
}

it('names its button by the summary a screen reader reads, never by the record id', async () => {
  const view = await render(<TransactionListItem transaction={transaction} open={false} onToggle={() => {}} />);
  expect(view.getByRole('button', { name: /^Outgoing · Ethereum, Base · .+, Pending, 2 ETH$/ })).toBeCollapsed();
  expect(view.queryByRole('button', { name: /synthetic-transaction/ })).toBeNull();
});

it.each([
  ['confirmed', '✓ Confirmed', 'Confirmed'],
  ['failed', '✗ Failed', 'Failed'],
] as const)('shows %s as %s but names the entry by the word alone', async (status, label, word) => {
  const view = await render(
    <TransactionListItem transaction={{ ...transaction, status }} open={false} onToggle={() => {}} />,
  );
  expect(view.getByText(label)).toBeTruthy();
  expect(
    view.getByRole('button', { name: new RegExp(`^Outgoing · Ethereum, Base · .+, ${word}, 2 ETH$`) }),
  ).toBeTruthy();
  expect(view.queryByRole('button', { name: /[✓✗]/ })).toBeNull();
});

it('shows no detail while closed and hands the entry to its toggle', async () => {
  const toggle = jest.fn();
  const view = await render(<TransactionListItem transaction={transaction} open={false} onToggle={toggle} />);
  const row = view.getByRole('button');
  expect(row).toBeCollapsed();
  expect(view.getByText('Outgoing · Ethereum')).toBeTruthy();
  expect(view.queryByText('Recorded')).toBeNull();
  expect(view.queryByText('View on Explorer')).toBeNull();
  await fireEvent.press(row);
  expect(toggle).toHaveBeenCalledWith(transaction);
  expect(toggle).toHaveBeenCalledTimes(1);
});

it.each([
  ['success', 'Unknown'],
  ['confirmed', '✓ Confirmed'],
  ['pending', 'Pending'],
  ['failed', '✗ Failed'],
  ['replaced', 'Replaced'],
  ['reorged', 'Confirmation reversed'],
  ['unrecognized', 'Unknown'],
  ['constructor', 'Unknown'],
  [undefined, 'Unknown'],
] as const)('shows %s as %s in the opened detail', async (status, label) => {
  const { detail } = await opened(Object.assign({ ...transaction }, { status }));
  expect(within(detail).getByText(label)).toBeTruthy();
  if (status !== 'failed') expect(within(detail).queryByText('✗ Failed')).toBeNull();
});

it.each([
  ['confirmed', '✓ Confirmed', 'Confirmed'],
  ['failed', '✗ Failed', 'Failed'],
] as const)('shows %s as %s in the opened detail but reads it as the word alone', async (status, label, word) => {
  const { detail } = await opened({ ...transaction, status });
  expect(within(detail).getByText(label)).toHaveAccessibleName(word);
  expect(within(detail).getByText('Status')).toHaveAccessibleName('Status');
});

it('updates an open pending import when its receipt confirms', async () => {
  const { view, detail } = await opened({ ...transaction, status: 'pending' });
  expect(within(detail).getByText('Pending')).toBeTruthy();
  await view.rerender(
    <TransactionListItem transaction={{ ...transaction, status: 'confirmed' }} open onToggle={() => {}} />,
  );
  expect(within(detail).getByText('✓ Confirmed')).toBeTruthy();
  expect(view.queryByText('Pending')).toBeNull();
  expect(view.queryByText('✗ Failed')).toBeNull();
});

it('shows a share transfer by its class symbol in the summary and the detail, not the bridged asset symbol', async () => {
  const share = {
    ...transaction,
    assetSymbol: 'ORD.123456782',
    assetName: 'Second Fictional Pty Ltd Ordinary Shares',
    shareClass: { uuid: 'class-2', name: 'Ordinary Shares', symbol: 'ORD', companyName: 'Second Fictional Pty Ltd' },
    amount: '40.000000000000000000',
  };
  const { view, detail } = await opened(share);

  expect(
    view.getByRole('button', { name: /^Outgoing · Second Fictional Pty Ltd Ordinary Shares, .+, 40 ORD$/ }),
  ).toBeTruthy();
  expect(within(detail).getByText('40 ORD')).toBeTruthy();
  expect(view.queryByText(/ORD\.123456782/)).toBeNull();
});
