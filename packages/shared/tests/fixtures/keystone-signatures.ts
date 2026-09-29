export const KEYSTONE_SIGNATURE_LENGTHS = [
  [1, 65],
  [8453, 66],
  [31337, 66],
  [84532, 67],
  [11155111, 68],
] as const;

function hexBytes(hex: string): number[] {
  return Array.from({ length: (hex.length - 2) / 2 }, (_, index) =>
    parseInt(hex.slice(2 + index * 2, 4 + index * 2), 16),
  );
}

export function legacyV(chainId: number | bigint, yParity: number): bigint {
  return BigInt(chainId) * 2n + 35n + BigInt(yParity);
}

export function keystoneSignatureBytes(r: string, s: string, v: bigint): Uint8Array {
  const vBytes = [Number(v & 0xffn)];
  for (let rest = v >> 8n; rest > 0n; rest >>= 8n) vBytes.unshift(Number(rest & 0xffn));
  return Uint8Array.from([...hexBytes(r), ...hexBytes(s), ...vBytes]);
}
