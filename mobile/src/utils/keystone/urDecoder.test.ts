import { ETHSignature } from '@keystonehq/bc-ur-registry-eth';
import { BtcSignature } from '@keystonehq/bc-ur-registry-btc';
import { Transaction, Wallet } from 'ethers';
import fixture from '../../../../packages/shared/tests/fixtures/prepared-transfer-api.json';
import {
  KEYSTONE_SIGNATURE_LENGTHS,
  keystoneSignatureBytes,
  legacyV,
} from '../../../../packages/shared/tests/fixtures/keystone-signatures';
import { preparedTransferTransaction } from '../preparedTransfer';
import { decodeKeystoneSignature } from './urDecoder';

const device = new Wallet(`0x${'42'.repeat(32)}`);
const other = new Wallet(`0x${'43'.repeat(32)}`);

function scan(signature: Uint8Array) {
  return new ETHSignature(Buffer.from(signature)).toUREncoder(1000).nextPart();
}

function signedOn(chainId: number, key = device, v = (yParity: number) => legacyV(chainId, yParity)) {
  const transaction = preparedTransferTransaction({ ...fixture.native.transaction, chainId });
  const { r, s, yParity } = key.signingKey.sign(Transaction.from(transaction).unsignedHash);
  return { transaction, signature: keystoneSignatureBytes(r, s, v(yParity)) };
}

it.each(KEYSTONE_SIGNATURE_LENGTHS)(
  'decodes what the Keystone firmware sends for chain %i, a %i-byte signature',
  (chainId, length) => {
    const { transaction, signature } = signedOn(chainId);
    expect(signature).toHaveLength(length);
    const signed = Transaction.from(decodeKeystoneSignature(scan(signature), transaction, device.address));
    expect(signed.from).toBe(device.address);
    expect(signed.chainId).toBe(BigInt(chainId));
    expect(signed.type).toBe(0);
  },
);

const onBaseSepolia = signedOn(84532);

function widened(signature: Uint8Array, zeros: number) {
  return Uint8Array.from([...signature.subarray(0, 64), ...Array<number>(zeros).fill(0), ...signature.subarray(64)]);
}

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
  expect(() => decodeKeystoneSignature(scan(signature), onBaseSepolia.transaction, device.address)).toThrow(message);
});

it('refuses a code that is not a Keystone signature', () => {
  expect(() => decodeKeystoneSignature('ur:bytes/hdcxwkfrwnmenjcy', onBaseSepolia.transaction, device.address)).toThrow(
    'The scanned code is not a Keystone signature.',
  );
});

it('refuses a Bitcoin signature code even when it carries a transaction signature', () => {
  const code = new BtcSignature(Buffer.from(onBaseSepolia.signature), Buffer.alloc(16, 1), Buffer.alloc(33, 2));
  expect(() =>
    decodeKeystoneSignature(code.toUREncoder(1000).nextPart(), onBaseSepolia.transaction, device.address),
  ).toThrow('The scanned code is not a Keystone signature.');
});
