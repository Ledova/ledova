export function readWei(value: unknown): bigint | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  return typeof value === 'string' && /^0x(0|[1-9a-f][0-9a-f]{0,63})$/.test(value) ? BigInt(value) : null;
}
