import { render, waitFor } from '@testing-library/react-native';
import { Transaction } from 'ethers';
import type { TransactionData, Wallet } from '@ledova/shared';
import fixture from '../../../../../packages/shared/tests/fixtures/prepared-transfer-api.json';
import { getSeedPhrase } from '../../../services/secureKeyStorage';
import { signEthereumTransaction } from '../../../utils/softwareWallet';
import { preparedTransferTransaction } from '../../../utils/preparedTransfer';
import { SoftwareSignTransaction } from './SoftwareSignTransaction';

jest.mock('../../../services/secureKeyStorage', () => ({ getSeedPhrase: jest.fn() }));

const { mnemonic, derivationPath } = fixture.signer;
const wallet = {
  uuid: 'software-wallet',
  address: fixture.signer.address,
  derivationPath,
  masterFingerprint: '12345678',
  signingPreference: 'software',
} as Wallet;

async function signWith(transactionData: TransactionData) {
  jest.mocked(getSeedPhrase).mockResolvedValue(mnemonic);
  const onSignComplete = jest.fn();
  const view = await render(
    <SoftwareSignTransaction
      wallet={wallet}
      transactionData={transactionData}
      onSignComplete={onSignComplete}
      signTrigger={1}
    />,
  );
  return { view, onSignComplete };
}

it.each(['native', 'token'] as const)('signs the %s transfer the backend sent, gas limit included', async (kind) => {
  const prepared = fixture[kind];
  const { onSignComplete } = await signWith(prepared);
  await waitFor(() => expect(onSignComplete).toHaveBeenCalledTimes(1), { timeout: 5000 });
  const signed = onSignComplete.mock.calls[0][0];
  expect(Transaction.from(signed).gasLimit).toBe(BigInt(prepared.gasLimit));
  expect(signed).toBe(
    await signEthereumTransaction(mnemonic, derivationPath, preparedTransferTransaction(prepared.transaction)),
  );
});

it('refuses a prepared transaction without a gas limit before reading the seed', async () => {
  const transaction = { ...fixture.native.transaction, gas: undefined };
  const { view, onSignComplete } = await signWith({ ...fixture.native, transaction } as unknown as TransactionData);
  expect(await view.findByText('The prepared transaction has no valid gas limit.')).toBeTruthy();
  expect(getSeedPhrase).not.toHaveBeenCalled();
  expect(onSignComplete).not.toHaveBeenCalled();
});

it('refuses a native transfer whose recipient is not the one reviewed', async () => {
  const { view, onSignComplete } = await signWith({ ...fixture.native, toAddress: fixture.signer.address });
  expect(await view.findByText('Transaction recipient does not match expected address')).toBeTruthy();
  expect(getSeedPhrase).not.toHaveBeenCalled();
  expect(onSignComplete).not.toHaveBeenCalled();
});
