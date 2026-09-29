import { expect, it } from 'vitest';
import { DataItem, extend } from '@keystonehq/bc-ur-registry';
import { UR, UREncoder } from '@ngraveio/bc-ur';
import { Transaction, Wallet, toQuantity } from 'ethers';
import fixture from '../../../../packages/shared/tests/fixtures/prepared-transfer-api.json';
import {
  KEYSTONE_SIGNATURE_LENGTHS,
  keystoneSignatureBytes,
  legacyV,
} from '../../../../packages/shared/tests/fixtures/keystone-signatures';
import { decodeKeystoneSignedTransaction } from './urDecoder';

const device = new Wallet(`0x${'42'.repeat(32)}`);
const other = new Wallet(`0x${'43'.repeat(32)}`);
const prepared = fixture.native.transaction;

function scan(signature: Uint8Array, type = 'eth-signature') {
  const item = new DataItem({ 2: Buffer.from(signature) });
  return new UREncoder(new UR(extend.encodeDataItem(item), type), 400).nextPart();
}

function signedOn(chainId: number, key = device, v = (yParity: number) => legacyV(chainId, yParity)) {
  const unsignedTx = {
    to: prepared.to,
    value: toQuantity(BigInt(prepared.value)),
    gas: toQuantity(prepared.gas),
    gasPrice: toQuantity(prepared.gasPrice),
    nonce: toQuantity(prepared.nonce),
    data: '0x',
    chainId: toQuantity(chainId),
  };
  const unsigned = Transaction.from({
    type: 0,
    to: unsignedTx.to,
    value: BigInt(prepared.value),
    gasLimit: prepared.gas,
    gasPrice: prepared.gasPrice,
    nonce: prepared.nonce,
    chainId,
  });
  const { r, s, yParity } = key.signingKey.sign(unsigned.unsignedHash);
  return { unsignedTx, signature: keystoneSignatureBytes(r, s, v(yParity)) };
}

function widened(signature: Uint8Array, zeros: number) {
  return Uint8Array.from([...signature.subarray(0, 64), ...Array<number>(zeros).fill(0), ...signature.subarray(64)]);
}

it.each(KEYSTONE_SIGNATURE_LENGTHS)(
  'decodes what the Keystone firmware sends for chain %i, a %i-byte signature',
  (chainId, length) => {
    const { unsignedTx, signature } = signedOn(chainId);
    expect(signature).toHaveLength(length);
    const signed = Transaction.from(decodeKeystoneSignedTransaction(scan(signature), unsignedTx, device.address));
    expect(signed.from).toBe(device.address);
    expect(signed.chainId).toBe(BigInt(chainId));
    expect(signed.value).toBe(BigInt(prepared.value));
  },
);

const onBaseSepolia = signedOn(84532);

it.each([
  [
    'a v for another chain',
    signedOn(84532, device, (yParity) => legacyV(11155111, yParity)).signature,
    'The scanned signature is not for this network.',
  ],
  ['v = 2', signedOn(84532, device, () => 2n).signature, 'The scanned signature is not for this network.'],
  ['64 bytes', onBaseSepolia.signature.subarray(0, 64), 'The scanned code is not a transaction signature.'],
  ['73 bytes', widened(onBaseSepolia.signature, 6), 'The scanned code is not a transaction signature.'],
  ['a signature from another key', signedOn(84532, other).signature, 'The scanned signature is not from this wallet.'],
])('refuses %s', (_, signature, message) => {
  expect(() => decodeKeystoneSignedTransaction(scan(signature), onBaseSepolia.unsignedTx, device.address)).toThrow(
    message,
  );
});

it('refuses a long payload it once passed on unread as a signed transaction', () => {
  const payload = Uint8Array.from(Array<number>(120).fill(1));
  expect(() => decodeKeystoneSignedTransaction(scan(payload), onBaseSepolia.unsignedTx, device.address)).toThrow(
    'The scanned code is not a transaction signature.',
  );
});

it('refuses a Bitcoin signature code even when it carries a transaction signature', () => {
  const code = scan(onBaseSepolia.signature, 'btc-signature');
  expect(() => decodeKeystoneSignedTransaction(code, onBaseSepolia.unsignedTx, device.address)).toThrow(
    'The scanned code is not a Keystone signature.',
  );
});
