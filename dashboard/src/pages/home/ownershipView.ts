import { hasWholeShares, type CompanyOwnershipSummary, type OwnMemberRecord } from '@ledova/shared';
import { sharedMemberOwnership } from './memberOwnership';

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
