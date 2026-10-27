import { hasWholeShares, type CompanyOwnershipSummary, type OwnMemberRecord } from '@ledova/shared';

export type OwnershipClass = Pick<
  CompanyOwnershipSummary['classes'][number],
  'uuid' | 'name' | 'symbol' | 'issuedSupply' | 'initialized' | 'totalHolders'
> & {
  ownShares: string | null;
};

export function ownershipView(summary: CompanyOwnershipSummary | undefined, record: OwnMemberRecord | undefined) {
  if (
    record &&
    (!hasWholeShares(record.classes) || new Set(record.classes.map(({ uuid }) => uuid)).size !== record.classes.length)
  )
    return null;
  const recorded = summary ?? (record ? sharedMemberOwnership(record) : null);
  const company =
    recorded && recorded.classes.length === 0
      ? { ...recorded, complete: false, issuedSupply: null, totalHolders: null }
      : recorded;
  if (company) {
    const classes: OwnershipClass[] = company.classes.map((row) => ({
      ...row,
      ownShares:
        record && row.initialized ? (record.classes.find(({ uuid }) => uuid === row.uuid)?.shares ?? '0') : null,
    }));
    if (
      classes.some(
        (row) =>
          row.initialized &&
          row.issuedSupply !== null &&
          row.ownShares !== null &&
          BigInt(row.ownShares) > BigInt(row.issuedSupply),
      )
    )
      return null;
    return { classes, total: company.issuedSupply, complete: company.complete, personalOnly: false, summary: company };
  }
  if (!record) return null;
  const classes: OwnershipClass[] = record.classes.map((row) => ({
    uuid: row.uuid,
    name: row.name,
    symbol: row.symbol,
    issuedSupply: row.shares,
    ownShares: row.shares,
    initialized: true,
    totalHolders: null,
  }));
  return {
    classes,
    total: String(classes.reduce((sum, row) => sum + BigInt(row.ownShares!), 0n)),
    complete: true,
    personalOnly: true,
    summary: null,
  };
}

const WHOLE = /^(0|[1-9][0-9]*)$/;
const quantity = (value: string | null): value is string => value !== null && WHOLE.test(value);
const count = (value: number | null) => value !== null && Number.isSafeInteger(value) && value >= 0;
type SharedOwnership = NonNullable<OwnMemberRecord['ownership']>;

function sharedMemberOwnership(record: OwnMemberRecord): SharedOwnership | null {
  const summary = record.ownership;
  if (
    !summary ||
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
