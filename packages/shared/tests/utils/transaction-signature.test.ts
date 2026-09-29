import { readTransactionSignature } from '../../src/utils/transaction-signature';
import { KEYSTONE_SIGNATURE_LENGTHS, keystoneSignatureBytes, legacyV } from '../fixtures/keystone-signatures';

const r = `0x${'11'.repeat(31)}01`;
const s = `0x${'22'.repeat(31)}02`;
const withV = (...v: number[]) => Uint8Array.from([...keystoneSignatureBytes(r, s, 0n).subarray(0, 64), ...v]);
const NETWORK = 'The scanned signature is not for this network.';
const LENGTH = 'The scanned code is not a transaction signature.';

it.each(KEYSTONE_SIGNATURE_LENGTHS)(
  'reads what the Keystone firmware sends on chain %i, a %i-byte signature',
  (chainId, length) => {
    for (const yParity of [0, 1] as const) {
      const signature = keystoneSignatureBytes(r, s, legacyV(chainId, yParity));
      expect(signature).toHaveLength(length);
      expect(readTransactionSignature(signature, BigInt(chainId))).toEqual({ r, s, yParity });
    }
  },
);

it.each([
  [27n, 0],
  [28n, 1],
  [0n, 0],
  [1n, 1],
])('also reads v = %s as parity %i', (v, yParity) => {
  expect(readTransactionSignature(keystoneSignatureBytes(r, s, v), 84532n)).toEqual({ r, s, yParity });
});

it('reads a v written with leading zero bytes, up to 72 bytes in all', () => {
  const signature = withV(0, 0, 0, 0, 0, 0x02, 0x94, 0x8c);
  expect(signature).toHaveLength(72);
  expect(readTransactionSignature(signature, 84532n)).toEqual({ r, s, yParity: 1 });
});

it.each([
  ['a v for another chain', keystoneSignatureBytes(r, s, legacyV(11155111, 0)), NETWORK],
  ['v = 2', withV(2), NETWORK],
  ['a parity of 2', keystoneSignatureBytes(r, s, legacyV(84532, 2)), NETWORK],
  ['64 bytes', withV(), LENGTH],
  ['73 bytes', withV(0, 0, 0, 0, 0, 0, 0x02, 0x94, 0x8b), LENGTH],
])('refuses %s', (_, signature, message) => {
  expect(() => readTransactionSignature(signature, 84532n)).toThrow(message);
});
