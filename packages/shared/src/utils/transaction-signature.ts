export interface TransactionSignature {
  r: string;
  s: string;
  yParity: 0 | 1;
}

function hex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function readTransactionSignature(signature: Uint8Array, chainId: bigint): TransactionSignature {
  if (signature.length < 65 || signature.length > 72)
    throw new Error('The scanned code is not a transaction signature.');
  const v = signature.subarray(64).reduce((total, byte) => (total << 8n) | BigInt(byte), 0n);
  const parity = [chainId * 2n + 35n, 27n, 0n].map((base) => v - base).find((offset) => offset === 0n || offset === 1n);
  if (parity === undefined) throw new Error('The scanned signature is not for this network.');
  return { r: hex(signature.subarray(0, 32)), s: hex(signature.subarray(32, 64)), yParity: parity === 1n ? 1 : 0 };
}
