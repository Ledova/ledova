import { formatShareCount, hasValidRegisterAwardTotals, type OwnMemberRecord } from '@ledova/shared';

type MemberClass = OwnMemberRecord['classes'][number];
export type MemberAward = OwnMemberRecord['awards'][number];

export interface CompanyHolding {
  record: OwnMemberRecord;
  classes: MemberClass[];
  awards: MemberAward[];
}

export interface PastHolding {
  record: OwnMemberRecord;
  item: MemberClass;
}

export const LIST_ABOVE = 6;

const none = (shares: string) => /^\d+$/.test(shares) && BigInt(shares) === 0n;

export function holdingsOf(records: OwnMemberRecord[]) {
  const sorted = [...records].sort((a, b) => a.company.name.localeCompare(b.company.name));
  const current: CompanyHolding[] = [];
  const past: PastHolding[] = [];
  for (const record of sorted) {
    const classes = record.classes.filter((item) => !none(item.shares));
    past.push(...record.classes.filter((item) => none(item.shares)).map((item) => ({ record, item })));
    if (classes.length > 0 || record.awards.length > 0) current.push({ record, classes, awards: record.awards });
  }
  return { current, past };
}

function counted(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

export function shareQuantity(shares: string) {
  return /^\d+$/.test(shares) ? formatShareCount(shares) : 'Unavailable';
}

export function awardQuantity(award: MemberAward) {
  return awardParts(award)
    ? `${formatShareCount(award.vestedShares)} of ${formatShareCount(award.shares)} vested`
    : 'Quantities unavailable';
}

export function holdingsSummary(current: CompanyHolding[]) {
  const classes = current.reduce((sum, holding) => sum + holding.classes.length, 0);
  const awards = current.reduce((sum, holding) => sum + holding.awards.length, 0);
  return [
    counted(current.length, 'company', 'companies'),
    counted(classes, 'share class', 'share classes'),
    ...(awards > 0 ? [counted(awards, 'award', 'awards')] : []),
  ].join(' · ');
}

export function initials(name: string) {
  const words = name
    .replace(/\b(pty|ltd|limited|proprietary)\b\.?/gi, '')
    .split(/\s+/)
    .filter((word) => /^[A-Za-z0-9]/.test(word));
  return (
    words
      .slice(0, 2)
      .map((word) => word[0])
      .join('') || name.slice(0, 2)
  ).toUpperCase();
}

export function awardParts(award: MemberAward) {
  if (!hasValidRegisterAwardTotals(award)) return null;
  const promised = BigInt(award.shares);
  return [
    { part: 'issued', quantity: BigInt(award.issuedShares) },
    { part: 'available', quantity: BigInt(award.availableShares) },
    { part: 'unvested', quantity: BigInt(award.unvestedRemainingShares) },
    { part: 'ended', quantity: BigInt(award.endedUnvestedShares) + BigInt(award.endedVestedShares) },
  ].map(({ part, quantity }) => ({ part, width: Number((quantity * 10000n) / promised) / 100 }));
}
