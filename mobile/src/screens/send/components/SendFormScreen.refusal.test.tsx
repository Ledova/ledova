import { AccessibilityInfo, Platform } from 'react-native';
import { cleanup, render } from '@testing-library/react-native';
import type { TransferableAsset } from '@ledova/shared';
import { useTransfers } from '../../transfers/useTransfers';
import { SendFormScreen } from './SendFormScreen';

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../../transfers/useTransfers', () => ({ useTransfers: jest.fn() }));
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  useCurrency: () => ({ formatDisplayCurrency: (value: number) => `AUD ${value}` }),
}));
jest.mock('../../../utils/keystone/urEncoder', () => ({ encodeEthereumTransaction: jest.fn() }));
jest.mock('../../../utils/keystone/urDecoder', () => ({ decodeKeystoneSignature: jest.fn() }));
jest.mock('../../../components/qr', () => ({ QRScanner: () => null, QRDisplay: () => null }));

const REFUSAL =
  'This wallet has no current approval with any company, so it cannot send AUDY. ' +
  'Ask the operator to approve it, then try again.';
const RECIPIENT_REFUSAL =
  'The recipient has no current approval with any company, so it cannot receive AUDY. ' +
  'Check the address, or ask the recipient to have their wallet approved.';
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

function refusing(prepareError: string | null) {
  jest.mocked(useTransfers).mockReturnValue({
    wallet,
    wallets: [],
    step: 'enter-details',
    transferableAssets: assets,
    selectedAsset: assets[1],
    toAddress: `0x${'2'.repeat(40)}`,
    amount: '5',
    isLoading: false,
    isLoadingHoldings: false,
    isPreparing: false,
    prepareError,
    selectWallet: jest.fn(),
    reset: jest.fn(),
  } as unknown as ReturnType<typeof useTransfers>);
}

it.each([
  ['iOS', 'ios', [[REFUSAL], [RECIPIENT_REFUSAL], [REFUSAL]]],
  ['Android, which announces its live region itself,', 'android', []],
] as const)(
  'on %s announces each new refusal on Wallets > Send (SendFormScreen) once, not a re-render or a clear',
  async (_, os, announced) => {
    jest.replaceProperty(Platform, 'OS', os);
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    refusing(REFUSAL);
    const view = await render(<SendFormScreen onDone={jest.fn()} />);
    await view.rerender(<SendFormScreen onDone={jest.fn()} />);
    refusing(RECIPIENT_REFUSAL);
    await view.rerender(<SendFormScreen onDone={jest.fn()} />);
    refusing(null);
    await view.rerender(<SendFormScreen onDone={jest.fn()} />);
    refusing(REFUSAL);
    await view.rerender(<SendFormScreen onDone={jest.fn()} />);
    expect(announce.mock.calls).toEqual(announced);
  },
);

it("announces a refused prepare's message on Wallets > Send (SendFormScreen), directly above Back and Continue, outside the form that scrolls", async () => {
  refusing(REFUSAL);
  const view = await render(<SendFormScreen onDone={jest.fn()} />);

  const message = view.getByRole('alert', { name: REFUSAL });
  expect(message.props.accessibilityLiveRegion).toBe('polite');
  const actions = view.getByRole('button', { name: 'Continue' }).parent!;
  expect(view.getByRole('button', { name: 'Back' }).parent).toBe(actions);
  expect(view.getByRole('header', { name: 'Send' }).parent!.children.slice(-2)).toEqual([message, actions]);
  expect(ancestors(message)).not.toContain('RCTScrollView');
  expect(view.getAllByText(REFUSAL)).toHaveLength(1);
});
