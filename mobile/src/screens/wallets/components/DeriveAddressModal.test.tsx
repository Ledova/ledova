import { cleanup, render, renderHook } from '@testing-library/react-native';
import type { Wallet } from '@ledova/shared';
import { useAppTheme } from '../../../contexts';
import { DeriveAddressModal } from './DeriveAddressModal';

const mockAddress = `0x${'4'.repeat(40)}`;
const mockPath = "m/44'/60'/0'/0/1";

jest.mock('../../../utils/keystone/bcurDecoder', () => ({
  deriveAddressFromParentKey: () => ({
    address: mockAddress,
    addressIndex: 1,
    derivationPath: mockPath,
    networkType: 'ETH',
  }),
}));

afterEach(async () => {
  await cleanup();
});

it('shows the network and index in the medium face, as the web does, the address and path in monospace and a 12pt note', async () => {
  const theme = (await renderHook(() => useAppTheme())).result.current;
  const wallet = {
    uuid: 'wallet',
    chain: 'ethereum',
    signingPreference: 'hardware',
    addressIndex: 0,
    parentPublicKey: 'parent-key',
    parentChainCode: 'chain-code',
    parentDerivationPath: "m/44'/60'/0'",
  } as Wallet;
  const view = await render(
    <DeriveAddressModal visible wallet={wallet} onConfirm={jest.fn()} onClose={jest.fn()} onRetry={jest.fn()} />,
  );
  expect(view.getByText('Ethereum')).toHaveStyle({ fontFamily: theme.fontFamily.medium });
  expect(view.getByText('1')).toHaveStyle({ fontFamily: theme.fontFamily.medium });
  expect(view.getByText(mockAddress)).toHaveStyle({ fontFamily: theme.fontFamily.mono });
  expect(view.getByText(mockPath)).toHaveStyle({ fontFamily: theme.fontFamily.mono });
  expect(view.getByText('This address shares the same master fingerprint as your existing wallet')).toHaveStyle({
    fontSize: 12,
    color: theme.colors.text.secondary,
  });
});
