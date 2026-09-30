import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { BitcoinSendScreen } from './BitcoinSendScreen';
import { useTransfers } from '../useTransfers';

jest.mock('../useTransfers', () => ({ useTransfers: jest.fn() }));
jest.mock('../../../utils/keystone/urEncoder', () => ({ encodeEthereumTransaction: jest.fn() }));
jest.mock('../../../utils/keystone/urDecoder', () => ({ decodeKeystoneSignature: jest.fn() }));
jest.mock('../../../components/GradientBackground', () => ({
  GradientBackground: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../../../components/qr', () => ({ QRScanner: () => null, QRDisplay: () => null }));
jest.mock('./SendForm', () => ({ SendForm: () => null }));

type Props = ComponentProps<typeof BitcoinSendScreen>;

const wallet = {
  uuid: 'cold-storage',
  chain: 'bitcoin',
  name: 'Cold storage',
  address: `tb1q${'3'.repeat(38)}`,
  signingPreference: 'hardware',
};

afterEach(async () => {
  await cleanup();
});

async function openForm(params: Props['route']['params']) {
  jest.mocked(useTransfers).mockReturnValue({
    wallet,
    step: 'enter-details',
    transferableAssets: [],
    isPreparing: false,
    selectWallet: jest.fn(),
    reset: jest.fn(),
  } as unknown as ReturnType<typeof useTransfers>);
  const navigation = { goBack: jest.fn() };
  const route = { key: 'transfer', name: 'BitcoinSend', params } as Props['route'];
  const view = await render(
    <BitcoinSendScreen route={route} navigation={navigation as unknown as Props['navigation']} />,
  );
  return { view, navigation };
}

it('offers Cancel on the Bitcoin form that Send opened directly, and leaves the form with it', async () => {
  const { view, navigation } = await openForm({ wallet } as Props['route']['params']);

  expect(view.queryByRole('button', { name: 'Back' })).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
});

it('offers Back on the Bitcoin form reached from the choice, and returns to the choice with it', async () => {
  const { view, navigation } = await openForm({ wallet, chosen: true } as Props['route']['params']);

  expect(view.queryByRole('button', { name: 'Cancel' })).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Back' }));
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
});
