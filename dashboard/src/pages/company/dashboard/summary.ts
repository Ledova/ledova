import type { TokenHoldersResponse } from '@ledova/shared';

export function ownershipSummary(registers: TokenHoldersResponse[]) {
  const classes = new Set<string>();
  const members = new Set<string>();
  let issued = 0n;
  let unopened = 0;
  for (const register of registers) {
    if (classes.has(register.token.uuid)) throw new Error('A share class was counted more than once.');
    classes.add(register.token.uuid);
    if (!register.initialized) {
      if (register.issuedSupply !== null || register.holders.length || register.totalHolders !== 0)
        throw new Error('The unopened register returned recorded ownership.');
      unopened += 1;
      continue;
    }
    if (register.issuedSupply === null || !/^\d+$/.test(register.issuedSupply))
      throw new Error('The register did not identify its issued shares.');
    const supply = BigInt(register.issuedSupply);
    const holders = new Set<string>();
    let holdings = 0n;
    for (const holder of register.holders) {
      if (
        !holder.member ||
        holders.has(holder.member) ||
        !/^\d+$/.test(holder.balance) ||
        BigInt(holder.balance) <= 0n ||
        !Number.isFinite(holder.percentage) ||
        holder.percentage < 0 ||
        holder.percentage > 100
      )
        throw new Error('The register did not identify complete current holdings.');
      holders.add(holder.member);
      members.add(holder.member);
      holdings += BigInt(holder.balance);
    }
    if (holdings !== supply || register.totalHolders !== holders.size)
      throw new Error('Issued shares and current holdings do not agree.');
    issued += supply;
  }
  return {
    issued: unopened ? null : issued.toString(),
    shareholders: unopened ? null : members.size,
    classes: classes.size,
    unopened,
  };
}

export function countBarWidth(shares: string, maximum: string) {
  const total = BigInt(maximum);
  return total === 0n ? 0 : Number((BigInt(shares) * 10000n) / total) / 100;
}
