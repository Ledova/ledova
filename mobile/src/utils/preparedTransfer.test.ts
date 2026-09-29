import { EthSignRequest, ETHSignature } from '@keystonehq/bc-ur-registry-eth';
import { HDNodeWallet, Interface, MaxUint256, Transaction, getAddress, parseEther, parseUnits } from 'ethers';
import fixture from '../../../packages/shared/tests/fixtures/prepared-transfer-api.json';
import { preparedTransferTransaction } from './preparedTransfer';
import { signEthereumTransaction } from './softwareWallet/localSigner';
import { encodeEthereumTransaction } from './keystone/urEncoder';
import { decodeKeystoneSignature } from './keystone/urDecoder';

jest.mock('uuid', () => ({ v4: () => '70000000-0000-4000-8000-000000000001' }));

const { mnemonic, derivationPath } = fixture.signer;
const erc20 = new Interface(['function transfer(address to, uint256 amount)']);

async function sign(transaction: unknown) {
  const signed = await signEthereumTransaction(mnemonic, derivationPath, preparedTransferTransaction(transaction));
  return Transaction.from(signed);
}

it('signs the native send the backend prepared with the gas limit, fee, nonce, chain, amount and recipient reviewed', async () => {
  const prepared = fixture.native;
  const signed = await sign(prepared.transaction);
  expect(signed.from).toBe(prepared.fromAddress);
  expect(signed.type).toBe(0);
  expect(signed.gasLimit).toBe(BigInt(prepared.gasLimit));
  expect(signed.gasPrice).toBe(BigInt(prepared.gasPriceWei));
  expect(signed.nonce).toBe(prepared.transaction.nonce);
  expect(signed.chainId).toBe(BigInt(prepared.transaction.chainId));
  expect(signed.to).toBe(getAddress(prepared.toAddress));
  expect(signed.value).toBe(parseEther(prepared.amountEth));
  expect(signed.data).toBe('0x');
});

it('signs the token send the backend prepared with its transfer call and the gas limit reviewed', async () => {
  const prepared = fixture.token;
  const signed = await sign(prepared.transaction);
  expect(signed.from).toBe(prepared.fromAddress);
  expect(signed.type).toBe(0);
  expect(signed.gasLimit).toBe(BigInt(prepared.gasLimit));
  expect(signed.gasPrice).toBe(BigInt(prepared.gasPriceWei));
  expect(signed.nonce).toBe(prepared.transaction.nonce);
  expect(signed.chainId).toBe(BigInt(prepared.transaction.chainId));
  expect(signed.to).toBe(prepared.tokenContract);
  expect(signed.value).toBe(0n);
  expect(erc20.decodeFunctionData('transfer', signed.data).toArray()).toEqual([
    getAddress(prepared.toAddress),
    parseUnits(prepared.amountToken, prepared.tokenDecimals),
  ]);
});

it.each(['nativeBeyondDouble', 'nativeEighteenPlaces'] as const)(
  'signs the %s amount to the wei, which a JavaScript number cannot hold',
  async (kind) => {
    const prepared = fixture[kind];
    const signed = await sign(prepared.transaction);
    expect(signed.value).toBe(parseEther(prepared.amountEth));
    expect(signed.value.toString()).toBe(prepared.transaction.value);
  },
);

it('still reads a value a backend sent as a safe JSON number', () => {
  expect(preparedTransferTransaction({ ...fixture.native.transaction, value: 1000 }).value).toBe(1000n);
});

it.each([
  ['gas limit', { gas: undefined }],
  ['gas limit', { gas: 0 }],
  ['gas limit', { gas: '21000' }],
  ['gas price', { gasPrice: undefined }],
  ['gas price', { gasPrice: 0 }],
  ['nonce', { nonce: undefined }],
  ['nonce', { nonce: -1 }],
  ['nonce', { nonce: 2 ** 53 }],
  ['chain id', { chainId: undefined }],
  ['chain id', { chainId: '0x7a69' }],
  ['value', { value: undefined }],
  ['value', { value: -1 }],
  ['value', { value: 0.5 }],
  ['value', { value: 2 ** 53 }],
  ['value', { value: '' }],
  ['value', { value: '0100' }],
  ['value', { value: '1.5' }],
  ['value', { value: '0x16345785d8a0000' }],
  ['value', { value: (MaxUint256 + 1n).toString() }],
  ['to address', { to: undefined }],
  ['to address', { to: '0x7E5F4552091A69125d5DfCb7b8C2659029395BDF' }],
  ['to address', { to: '0x7E5F4552091A69125d5DfCb7b8C2659029395B' }],
  ['data', { data: null }],
  ['data', { data: '0xa9059cb' }],
  ['data', { data: 'a9059cbb' }],
])('refuses a prepared transaction whose %s is missing or malformed (%o)', (field, change) => {
  expect(() => preparedTransferTransaction({ ...fixture.token.transaction, ...change })).toThrow(
    `The prepared transaction has no valid ${field}.`,
  );
});

it.each([undefined, null, JSON.stringify(fixture.native.transaction)])(
  'refuses a prepared transfer that carries no transaction object (%p)',
  (transaction) => {
    expect(() => preparedTransferTransaction(transaction)).toThrow('The prepared transaction is unavailable.');
  },
);

it('encodes the native send the backend prepared for Keystone and rebuilds the bytes the software signer makes', async () => {
  const prepared = fixture.native;
  const encoded = encodeEthereumTransaction(prepared.fromAddress, prepared.transaction, derivationPath, '12345678');
  expect(encoded).not.toBeNull();
  const request = EthSignRequest.fromCBOR(encoded!.cbor);
  const unsigned = Transaction.from(`0x${request.getSignData().toString('hex')}`);
  const device = HDNodeWallet.fromPhrase(mnemonic, undefined, derivationPath);
  const signature = device.signingKey.sign(unsigned.unsignedHash);
  const scanned = new ETHSignature(Buffer.from(signature.serialized.slice(2), 'hex')).toUREncoder(1000).nextPart();
  const expected = await signEthereumTransaction(
    mnemonic,
    derivationPath,
    preparedTransferTransaction(prepared.transaction),
  );
  expect(decodeKeystoneSignature(scanned, prepared.transaction)).toBe(expected);
});
