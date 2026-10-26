import { HOLDER_TYPE_LABELS, sharePercentage, type TokenHoldersResponse } from '@ledova/shared';

export function ownershipSegments(register: TokenHoldersResponse) {
  if (!register.initialized || register.issuedSupply === null || register.issuedSupply === '0') return [];
  const holders = [...register.holders].sort((left, right) => {
    const difference = BigInt(right.balance) - BigInt(left.balance);
    return difference === 0n ? left.member.localeCompare(right.member) : difference > 0n ? 1 : -1;
  });
  const segments = holders.slice(0, 5).map((holder) => ({
    member: holder.member as string | null,
    name: holder.name || HOLDER_TYPE_LABELS[holder.holderType],
    shares: holder.balance,
    holders: 1,
  }));
  const remaining = holders.slice(5);
  if (remaining.length) {
    const shares = remaining.reduce((total, holder) => total + BigInt(holder.balance), 0n).toString();
    segments.push({
      member: null,
      name: 'Others',
      shares,
      holders: remaining.length,
    });
  }
  return segments.map((segment) => ({
    ...segment,
    percentage: sharePercentage(segment.shares, register.issuedSupply),
  }));
}
