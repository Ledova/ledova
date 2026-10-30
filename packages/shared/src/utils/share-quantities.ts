export function wholeShares(value: string): bigint | null {
  return /^\d+$/.test(value) ? BigInt(value) : null;
}

export function hasWholeShares(holdings: readonly { shares: string }[]) {
  return holdings.every(({ shares }) => wholeShares(shares) !== null);
}
