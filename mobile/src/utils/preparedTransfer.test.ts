import { EthSignRequest, ETHSignature } from '@keystonehq/bc-ur-registry-eth';
import { HDNodeWallet, Interface, Transaction, getAddress, parseEther, parseUnits } from 'ethers';
import type { TransactionData } from '@ledova/shared';
import fixture from '../../../packages/shared/tests/fixtures/prepared-transfer-api.json';
import { keystoneSignatureBytes, legacyV } from '../../../packages/shared/tests/fixtures/keystone-signatures';
import { preparedTransferTransaction, reviewedTransferTransaction } from './preparedTransfer';
import { signEthereumTransaction } from './softwareWallet/localSigner';
import { encodeEthereumTransaction } from './keystone/urEncoder';
import { decodeKeystoneSignature } from './keystone/urDecoder';

jest.mock('uuid', () => ({ v4: () => '70000000-0000-4000-8000-000000000001' }));

const { mnemonic, derivationPath } = fixture.signer;
const erc20 = new Interface([
  'function transfer(address to, uint256 amount)',
  'function approve(address spender, uint256 amount)',
]);
const stranger = `0x${'5'.repeat(40)}`;
const tokenAsset = { symbol: fixture.token.tokenSymbol, decimals: 2, contractAddress: fixture.token.tokenContract };

function differing(prepared: TransactionData, change: Record<string, unknown>) {
  return { ...prepared, transaction: { ...prepared.transaction, ...change } } as TransactionData;
}

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
    expect(signed.value).toBe(BigInt(prepared.transaction.value));
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
  ['value', { value: '100000000000000000' }],
  ['value', { value: '0x016345785d8a0000' }],
  ['value', { value: '0x16345785D8A0000' }],
  ['value', { value: `0x1${'0'.repeat(64)}` }],
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

it('encodes a reviewed send above 2^53 wei for Keystone and rebuilds the bytes the software signer makes', async () => {
  const prepared = fixture.nativeBeyondDouble;
  const transaction = reviewedTransferTransaction(prepared);
  const encoded = encodeEthereumTransaction(prepared.fromAddress, transaction, derivationPath, '12345678');
  expect(encoded).not.toBeNull();
  const request = EthSignRequest.fromCBOR(encoded!.cbor);
  const unsigned = Transaction.from(`0x${request.getSignData().toString('hex')}`);
  expect(unsigned.value).toBe(parseEther(prepared.amountEth));
  const device = HDNodeWallet.fromPhrase(mnemonic, undefined, derivationPath);
  const { r, s, yParity } = device.signingKey.sign(unsigned.unsignedHash);
  const firmware = Buffer.from(keystoneSignatureBytes(r, s, legacyV(unsigned.chainId, yParity)));
  expect(firmware).toHaveLength(66);
  const scanned = new ETHSignature(firmware).toUREncoder(1000).nextPart();
  const expected = await signEthereumTransaction(mnemonic, derivationPath, transaction);
  expect(decodeKeystoneSignature(scanned, transaction, prepared.fromAddress)).toBe(expected);
});

it.each(['native', 'nativeBeyondDouble', 'nativeEighteenPlaces'] as const)(
  'passes the %s send, which matches its review',
  (kind) => {
    expect(reviewedTransferTransaction(fixture[kind])).toEqual(preparedTransferTransaction(fixture[kind].transaction));
  },
);

it('passes a native send below a millionth of an ETH, which the backend writes out plainly', () => {
  const prepared = differing({ ...fixture.native, amountEth: '0.0000001' }, { value: '0x174876e800' });
  expect(reviewedTransferTransaction(prepared).value).toBe(100000000000n);
});

it('passes the token send, which matches its review in the decimals of the asset it was prepared for', () => {
  expect(reviewedTransferTransaction(fixture.token, tokenAsset)).toEqual(
    preparedTransferTransaction(fixture.token.transaction),
  );
});

it.each([
  [
    '0.5 ETH under a 0.1 ETH review',
    differing(fixture.native, { value: '0x6f05b59d3b20000' }),
    'the amount is different',
  ],
  ['one wei more', differing(fixture.nativeBeyondDouble, { value: '0x8ac7230235dc1c01' }), 'the amount is different'],
  ['another recipient', differing(fixture.native, { to: stranger }), 'the recipient is different'],
  ['a contract call', differing(fixture.native, { data: '0xa9059cbb' }), 'it is not a plain transfer'],
])('refuses a native send that differs from its review: %s', (_, prepared, reason) => {
  expect(() => reviewedTransferTransaction(prepared)).toThrow(
    `This transaction does not match your review: ${reason}.`,
  );
});

it.each([
  [
    'transfer(stranger, 999999)',
    { data: erc20.encodeFunctionData('transfer', [stranger, 999999n]) },
    'the recipient is different',
  ],
  ['another contract', { to: stranger }, 'it calls a different token contract'],
  [
    'another amount',
    { data: erc20.encodeFunctionData('transfer', [fixture.token.toAddress, 999999n]) },
    'the amount is different',
  ],
  ['ETH as well', { value: '0x1' }, 'it also sends ETH'],
  [
    'an approval',
    { data: erc20.encodeFunctionData('approve', [fixture.token.toAddress, 150n]) },
    'it is not a token transfer',
  ],
  ['a byte after the call', { data: `${fixture.token.transaction.data}00` }, 'it is not a token transfer'],
])('refuses a token send that differs from its review: %s', (_, change, reason) => {
  expect(() => reviewedTransferTransaction(differing(fixture.token, change), tokenAsset)).toThrow(
    `This transaction does not match your review: ${reason}.`,
  );
});

it("refuses a token send whose amount, in the token's own decimals, is not the one reviewed", () => {
  expect(() => reviewedTransferTransaction(fixture.token, { ...tokenAsset, decimals: 6 })).toThrow(
    'This transaction does not match your review: the amount is different.',
  );
});

it.each([
  ['another asset', { ...tokenAsset, contractAddress: stranger }],
  ['an asset without a contract', { ...tokenAsset, contractAddress: undefined }],
])('refuses a token send prepared for %s than the one reviewed', (_, asset) => {
  expect(() => reviewedTransferTransaction(fixture.token, asset)).toThrow(
    'This transaction does not match your review: it calls a different token contract.',
  );
});

it("passes a token send whose contract is written in another case than the asset's", () => {
  const asset = { ...tokenAsset, contractAddress: fixture.token.tokenContract.toLowerCase() };
  expect(reviewedTransferTransaction(fixture.token, asset)).toEqual(
    preparedTransferTransaction(fixture.token.transaction),
  );
});

it('refuses a token send when the asset it was prepared for is unknown', () => {
  expect(() => reviewedTransferTransaction(fixture.token)).toThrow(
    "The token's decimals are unknown, so this transfer cannot be checked against your review.",
  );
});
