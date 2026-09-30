import { cleanup, render } from '@testing-library/react-native';
import { formatWalletAddressShort, type Wallet } from '@ledova/shared';
import { WalletSummary } from './WalletSummary';

jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  useCurrency: () => ({ formatDisplayCurrency: (value: number) => `AUD ${value.toFixed(2)}` }),
}));

const wallet: Wallet = {
  uuid: 'summary',
  userAccount: 'owner',
  name: 'Savings',
  address: `0x${'7'.repeat(40)}`,
  chain: 'ethereum',
  verificationStatus: 'VERIFIED',
  verificationChallenge: null,
  verificationSignature: null,
  verifiedAt: null,
  lastSyncedAt: null,
  nativeBalance: '0.420000000000000000',
  nativeMarketValue: '12.5',
  marketValue: '12.5',
  signingPreference: 'hardware',
  createdAt: '2026-09-01',
  updatedAt: '2026-09-01',
};

afterEach(async () => {
  await cleanup();
});

it.each([
  ['VERIFIED', 'Wallet address verified'],
  ['PENDING', 'Wallet address verification pending'],
] as const)(
  'names the %s status and the signing preference as images, beside the sync age',
  async (verificationStatus, status) => {
    const view = await render(
      <WalletSummary wallet={{ ...wallet, verificationStatus, lastSyncedAt: new Date().toISOString() }} />,
    );
    expect(view.getAllByRole('img').map((image) => image.props.accessibilityLabel)).toEqual([
      status,
      'Hardware (self-declared)',
    ]);
    expect(view.getByText('just now')).toBeTruthy();
  },
);

it('invents no signing preference or sync age the wallet does not have', async () => {
  const synced = await render(
    <WalletSummary wallet={{ ...wallet, signingPreference: null, lastSyncedAt: new Date().toISOString() }} />,
  );
  expect(synced.getAllByRole('img').map((image) => image.props.accessibilityLabel)).toEqual([
    'Wallet address verified',
  ]);
  expect(synced.getByText('just now')).toBeTruthy();
  await cleanup();

  const unsynced = await render(<WalletSummary wallet={wallet} />);
  expect(unsynced.queryByText(/ago|just now/)).toBeNull();
});

it.each([
  ['base', '0.42 ETH'],
  ['ethereum', '0.42 ETH'],
  ['bitcoin', '0.42 BTC'],
] as const)("labels a %s wallet's balance in its native unit, and its value", async (chain, balance) => {
  const view = await render(<WalletSummary wallet={{ ...wallet, chain }} />);
  expect(view.getByText(balance).parent).toBe(view.getByText('Balance').parent);
  expect(view.getByText('AUD 12.50').parent).toBe(view.getByText('Estimated value').parent);
});

it('names an unnamed wallet by its short address in a chooser, and as Unnamed wallet over its address in a row', async () => {
  const unnamed = { ...wallet, name: '' };
  const choice = await render(<WalletSummary wallet={unnamed} compact />);
  expect(choice.getByText(formatWalletAddressShort(unnamed.address))).toBeTruthy();
  expect(choice.queryByText(unnamed.address)).toBeNull();
  expect(choice.queryByText('Address')).toBeNull();
  await cleanup();

  const row = await render(<WalletSummary wallet={unnamed} />);
  expect(row.getByText('Unnamed wallet')).toBeTruthy();
  expect(row.getByText(unnamed.address).parent).toBe(row.getByText('Address').parent);
});
