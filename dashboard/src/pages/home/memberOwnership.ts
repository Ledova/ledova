import { hasWholeShares, type OwnMemberRecord } from '@ledova/shared';

const WHOLE = /^(0|[1-9][0-9]*)$/;
const quantity = (value: string | null): value is string => value !== null && WHOLE.test(value);
const count = (value: number | null) => value !== null && Number.isSafeInteger(value) && value >= 0;
type SharedOwnership = NonNullable<OwnMemberRecord['ownership']>;

export function sharedMemberOwnership(record: OwnMemberRecord): SharedOwnership | null {
  const summary = record.ownership;
  if (
    !summary ||
    !hasWholeShares(record.classes) ||
    new Set(record.classes.map(({ uuid }) => uuid)).size !== record.classes.length ||
    summary.company !== record.company.uuid ||
    !Array.isArray(summary.classes) ||
    new Set(summary.classes.map(({ uuid }) => uuid)).size !== summary.classes.length
  )
    return null;
  if (record.classes.some((row) => BigInt(row.shares) > 0n && !summary.classes.some(({ uuid }) => uuid === row.uuid)))
    return null;
  for (const row of summary.classes) {
    const held = record.classes.find(({ uuid }) => uuid === row.uuid)?.shares ?? '0';
    if (quantity(row.ownShares) && BigInt(row.ownShares) !== BigInt(held)) return null;
    if (
      row.initialized
        ? !quantity(row.issuedSupply) ||
          !quantity(row.ownShares) ||
          !count(row.totalHolders) ||
          BigInt(row.ownShares) > BigInt(row.issuedSupply)
        : row.issuedSupply !== null || row.ownShares !== null || row.totalHolders !== null
    )
      return null;
  }
  if (summary.complete) {
    if (
      !quantity(summary.issuedSupply) ||
      !count(summary.totalHolders) ||
      summary.classes.some(({ initialized }) => !initialized) ||
      summary.classes.reduce((total, row) => total + BigInt(row.issuedSupply!), 0n) !== BigInt(summary.issuedSupply)
    )
      return null;
  } else if (summary.issuedSupply !== null || summary.totalHolders !== null) return null;
  return summary;
}
