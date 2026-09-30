import type { ComponentProps } from 'react';
import { cleanup, render } from '@testing-library/react-native';
import type { TransferableAsset } from '@ledova/shared';
import { TransferFormScreen } from './TransferFormScreen';
import { useTransfers } from '../useTransfers';

jest.mock('../useTransfers', () => ({ useTransfers: jest.fn() }));
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  useCurrency: () => ({ formatDisplayCurrency: (value: number) => `AUD ${value}` }),
}));
jest.mock('../../../utils/keystone/urEncoder', () => ({ encodeEthereumTransaction: jest.fn() }));
jest.mock('../../../utils/keystone/urDecoder', () => ({ decodeKeystoneSignature: jest.fn() }));
jest.mock('../../../components/GradientBackground', () => ({
  GradientBackground: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../../../components/qr', () => ({ QRScanner: () => null, QRDisplay: () => null }));

type Props = ComponentProps<typeof TransferFormScreen>;

const REFUSAL =
  'This wallet has no current approval with any company, so it cannot send AUDY. ' +
  'Ask the operator to approve it, then try again.';
const wallet = {
  uuid: 'base-wallet',
  chain: 'base',
  name: 'Savings',
  address: `0x${'1'.repeat(40)}`,
  signingPreference: 'software',
};
const assets = ['ETH', 'AUDY', 'USDC', 'EURC', 'TUSD'].map((symbol, index) => ({
  uuid: `asset-${index}`,
  symbol,
  name: symbol,
  balance: '10',
  marketValue: '10',
  isNative: index === 0,
  decimals: index === 0 ? 18 : 2,
  contractAddress: index === 0 ? undefined : `0x${String(index).repeat(40)}`,
  chain: 'base',
})) as TransferableAsset[];

interface Rendered {
  type: unknown;
  parent: Rendered | null;
}

function ancestors(element: Rendered) {
  const types: unknown[] = [];
  for (let node = element.parent; node; node = node.parent) types.push(node.type);
  return types;
}

afterEach(async () => {
  await cleanup();
});

it("keeps a refused prepare's message on screen, directly above Cancel and Continue, outside the form that scrolls", async () => {
  jest.mocked(useTransfers).mockReturnValue({
    wallet,
    step: 'enter-details',
    transferableAssets: assets,
    selectedAsset: assets[1],
    toAddress: `0x${'2'.repeat(40)}`,
    amount: '5',
    isLoadingHoldings: false,
    isPreparing: false,
    prepareError: REFUSAL,
    selectWallet: jest.fn(),
    reset: jest.fn(),
  } as unknown as ReturnType<typeof useTransfers>);
  const route = { key: 'transfer', name: 'TransferDetails', params: { wallet } } as Props['route'];
  const navigation = { goBack: jest.fn() } as unknown as Props['navigation'];
  const view = await render(<TransferFormScreen route={route} navigation={navigation} />);

  const message = view.getByText(REFUSAL);
  const actions = view.getByRole('button', { name: 'Continue' }).parent!;
  expect(view.getByRole('header', { name: 'Send' }).parent!.children.slice(-2)).toEqual([message, actions]);
  expect(ancestors(message)).not.toContain('RCTScrollView');
  expect(view.getAllByText(REFUSAL)).toHaveLength(1);
});
