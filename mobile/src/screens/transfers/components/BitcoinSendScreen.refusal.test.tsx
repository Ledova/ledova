import type { ComponentProps } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { cleanup, render } from '@testing-library/react-native';
import type { TransferableAsset } from '@ledova/shared';
import { BitcoinSendScreen } from './BitcoinSendScreen';
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

type Props = ComponentProps<typeof BitcoinSendScreen>;

const REFUSAL = 'Insufficient balance. Available: 0.001 BTC, Required: 0.01005 BTC (including 0.00005 BTC fee)';
const wallet = {
  uuid: 'cold-storage',
  chain: 'bitcoin',
  name: 'Cold storage',
  address: `tb1q${'3'.repeat(38)}`,
  signingPreference: 'hardware',
};
const bitcoin = {
  uuid: 'native-cold-storage',
  symbol: 'BTC',
  name: 'Bitcoin',
  balance: '0.001',
  marketValue: '100',
  isNative: true,
  decimals: 8,
  chain: 'bitcoin',
} as TransferableAsset;

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

const route = { key: 'transfer', name: 'BitcoinSend', params: { wallet } } as Props['route'];
const navigation = { goBack: jest.fn() } as unknown as Props['navigation'];

function refusing(prepareError: string | null) {
  jest.mocked(useTransfers).mockReturnValue({
    wallet,
    step: 'enter-details',
    transferableAssets: [bitcoin],
    selectedAsset: bitcoin,
    toAddress: `tb1q${'4'.repeat(38)}`,
    amount: '0.01',
    isLoadingHoldings: false,
    isPreparing: false,
    prepareError,
    selectWallet: jest.fn(),
    reset: jest.fn(),
  } as unknown as ReturnType<typeof useTransfers>);
}

it('on iOS announces each new refusal on the Bitcoin form (BitcoinSendScreen) once, not a re-render or a clear', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  refusing(REFUSAL);
  const view = await render(<BitcoinSendScreen route={route} navigation={navigation} />);
  await view.rerender(<BitcoinSendScreen route={route} navigation={navigation} />);
  refusing(null);
  await view.rerender(<BitcoinSendScreen route={route} navigation={navigation} />);
  refusing(REFUSAL);
  await view.rerender(<BitcoinSendScreen route={route} navigation={navigation} />);
  expect(announce.mock.calls).toEqual([[REFUSAL], [REFUSAL]]);
});

it("announces a refused prepare's message on the Bitcoin form (BitcoinSendScreen), directly above Cancel and Continue, outside the form that scrolls", async () => {
  refusing(REFUSAL);
  const view = await render(<BitcoinSendScreen route={route} navigation={navigation} />);

  const message = view.getByRole('alert', { name: REFUSAL });
  expect(message.props.accessibilityLiveRegion).toBe('polite');
  const actions = view.getByRole('button', { name: 'Continue' }).parent!;
  expect(view.getByRole('button', { name: 'Cancel' }).parent).toBe(actions);
  expect(view.getByRole('header', { name: 'Send' }).parent!.children.slice(-2)).toEqual([message, actions]);
  expect(ancestors(message)).not.toContain('RCTScrollView');
  expect(view.getAllByText(REFUSAL)).toHaveLength(1);
});
