import { fireEvent, render } from '@testing-library/react-native';
import type { HardwareWalletImport } from '@ledova/shared';
import { apiClient } from '../../../services/apiClient';
import { extractFromKeystoneQR } from '../../../utils/keystone/bcurDecoder';
import { HardwareAccountSelector } from './HardwareAccountSelector';

jest.mock('../../../services/apiClient', () => ({ apiClient: { post: jest.fn() } }));
jest.mock('../../../utils/keystone/bcurDecoder', () => ({ extractFromKeystoneQR: jest.fn() }));

const post = apiClient.post as jest.Mock;
const address = '0x' + 'a'.repeat(40);
const data: HardwareWalletImport = {
  addresses: [{ address, networkType: 'ETH', addressIndex: 0, derivationPath: "m/44'/60'/0'/0/0" }],
  masterFingerprint: 'fingerprint',
  parentKeys: [{ parentPublicKey: 'public', parentChainCode: 'chain', parentDerivationPath: "m/44'/60'/0'/0" }],
};

beforeEach(() => {
  post.mockReset();
  (extractFromKeystoneQR as jest.Mock).mockReturnValue(data);
});

it('shows the Base balance and imports on Base after changing the network', async () => {
  post.mockImplementation(async (_url, body) => ({
    data: {
      userAccount: body.userAccount,
      chain: body.chain,
      balances: { [address]: body.chain === 'base' ? '2' : '5' },
    },
  }));
  const selected = jest.fn();
  const view = await render(
    <HardwareAccountSelector urString="synthetic-qr" onSelectAccounts={selected} onCancel={jest.fn()} />,
  );
  await view.findByText('5 ETH');
  await fireEvent.press(view.getByLabelText('Base network'));
  await view.findByText('2 ETH');
  await fireEvent.press(view.getByText('Import Wallet'));
  expect(selected).toHaveBeenCalledWith([{ ...data.addresses[0], networkType: 'BASE' }], {
    ...data,
    addresses: [{ ...data.addresses[0], networkType: 'BASE' }],
  });
});

it('lists accounts as selectable rows under rules and ends with Cancel then Import Wallet', async () => {
  post.mockImplementation(async (_url, body) => ({
    data: { userAccount: body.userAccount, chain: body.chain, balances: { [address]: '5' } },
  }));
  const cancelled = jest.fn();
  const view = await render(
    <HardwareAccountSelector urString="synthetic-qr" onSelectAccounts={jest.fn()} onCancel={cancelled} />,
  );
  await view.findByText('5 ETH');
  const account = view.getByRole('button', { selected: true });
  expect(account).not.toHaveStyle({ borderWidth: 1 });
  expect(account.props.style).not.toHaveProperty('backgroundColor');
  await fireEvent.press(account);
  expect(view.getByRole('button', { selected: false, name: /Ethereum/ })).toBeTruthy();
  const cancel = view.getByRole('button', { name: 'Cancel' });
  expect(cancel.parent!.children).toEqual([cancel, view.getByRole('button', { name: 'Import Wallet' })]);
  expect(view.getByRole('button', { name: 'Import Wallet' })).toBeDisabled();
  await fireEvent.press(cancel);
  expect(cancelled).toHaveBeenCalledTimes(1);
});
