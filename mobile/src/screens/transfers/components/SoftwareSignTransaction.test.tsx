import { render, waitFor } from '@testing-library/react-native';
import { Interface, Transaction, parseEther } from 'ethers';
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
const erc20 = new Interface(['function transfer(address to, uint256 amount)']);
const stranger = `0x${'5'.repeat(40)}`;

function differing(prepared: TransactionData, change: Record<string, unknown>) {
  return { ...prepared, transaction: { ...prepared.transaction, ...change } } as TransactionData;
}

async function signWith(transactionData: TransactionData, tokenDecimals?: number) {
  jest.mocked(getSeedPhrase).mockResolvedValue(mnemonic);
  const onSignComplete = jest.fn();
  const view = await render(
    <SoftwareSignTransaction
      wallet={wallet}
      transactionData={transactionData}
      tokenDecimals={tokenDecimals}
      onSignComplete={onSignComplete}
      signTrigger={1}
    />,
  );
  return { view, onSignComplete };
}

it.each([
  ['native', fixture.native, undefined],
  ['token', fixture.token, 2],
] as const)('signs the %s transfer the backend sent, gas limit included', async (_, prepared, decimals) => {
  const { onSignComplete } = await signWith(prepared, decimals);
  await waitFor(() => expect(onSignComplete).toHaveBeenCalledTimes(1), { timeout: 5000 });
  const signed = onSignComplete.mock.calls[0][0];
  expect(Transaction.from(signed).gasLimit).toBe(BigInt(prepared.gasLimit));
  expect(signed).toBe(
    await signEthereumTransaction(mnemonic, derivationPath, preparedTransferTransaction(prepared.transaction)),
  );
});

it('signs 9.99999999 ETH to the wei', async () => {
  const { onSignComplete } = await signWith(fixture.nativeBeyondDouble);
  await waitFor(() => expect(onSignComplete).toHaveBeenCalledTimes(1), { timeout: 5000 });
  expect(Transaction.from(onSignComplete.mock.calls[0][0]).value).toBe(parseEther('9.99999999'));
});

it('refuses a prepared transaction without a gas limit before reading the seed', async () => {
  const { view, onSignComplete } = await signWith(differing(fixture.native, { gas: undefined }));
  expect(await view.findByText('The prepared transaction has no valid gas limit.')).toBeTruthy();
  expect(getSeedPhrase).not.toHaveBeenCalled();
  expect(onSignComplete).not.toHaveBeenCalled();
});

it.each([
  [
    'transfer(stranger, 999999)',
    differing(fixture.token, { data: erc20.encodeFunctionData('transfer', [stranger, 999999n]) }),
    'the recipient is different',
  ],
  ['another token contract', differing(fixture.token, { to: stranger }), 'it calls a different token contract'],
  [
    '0.5 ETH under a 0.1 ETH review',
    differing(fixture.native, { value: '500000000000000000' }),
    'the amount is different',
  ],
  ['another recipient', differing(fixture.native, { to: stranger }), 'the recipient is different'],
])('refuses %s before reading the seed', async (_, prepared, reason) => {
  const { view, onSignComplete } = await signWith(prepared, 2);
  expect(await view.findByText(`This transaction does not match your review: ${reason}.`)).toBeTruthy();
  expect(getSeedPhrase).not.toHaveBeenCalled();
  expect(onSignComplete).not.toHaveBeenCalled();
});
