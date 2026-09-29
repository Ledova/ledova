export const MAX_REQUEST_SHARES = 2_147_483_647n;

export function wholeShares(value: string): bigint | null {
  return /^\d+$/.test(value) ? BigInt(value) : null;
}

export function requestShares(value: string): number | null {
  const shares = wholeShares(value);
  return shares !== null && shares > 0n && shares <= MAX_REQUEST_SHARES ? Number(shares) : null;
}

export function raisedSupply(current: string, additional: string): string | null {
  const supply = wholeShares(current);
  const delta = wholeShares(additional);
  return supply !== null && delta !== null && delta > 0n ? (supply + delta).toString() : null;
}
