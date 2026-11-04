import { PAGE_SIZE } from '../constants/api';
import { HOLDER_TYPE_LABELS } from '../constants/business/register';
import type { TokenHoldersResponse } from '../types';
import { formatShortDate } from './date';
import { sharePercentage } from './formatting';
import type { Person } from './people';
import { searchRows } from './search';

export type ShareholderHolding = { register: TokenHoldersResponse; holder: TokenHoldersResponse['holders'][number] };

export type Shareholder = { member: string; name: string; holdings: ShareholderHolding[] };

export function needsIdentityReview({ holder }: Pick<ShareholderHolding, 'holder'>) {
  return holder.holderType === 'ambiguous' || holder.holderType === 'unidentified';
}

export function holdingFacts({ register, holder }: ShareholderHolding) {
  const share = sharePercentage(holder.balance, register.issuedSupply);
  return [
    share === 'Not recorded' ? '% of class not recorded' : `${share} of class`,
    HOLDER_TYPE_LABELS[holder.holderType],
    holder.enteredOn ? `added ${formatShortDate(holder.enteredOn)}` : 'date added not recorded',
  ].join(' · ');
}

export function shareholderList(
  registers: TokenHoldersResponse[],
  people: readonly Person[],
  filter: { class: string; search: string; page: number },
) {
  const grouped = new Map<string, Shareholder>();
  for (const register of registers) {
    for (const holder of register.holders) {
      const existing = grouped.get(holder.member);
      const holding = { register, holder };
      if (existing) existing.holdings.push(holding);
      else
        grouped.set(holder.member, {
          member: holder.member,
          name: holder.name || HOLDER_TYPE_LABELS[holder.holderType],
          holdings: [holding],
        });
    }
  }
  const shareholders = [...grouped.values()].sort(
    (left, right) => left.name.localeCompare(right.name) || left.member.localeCompare(right.member),
  );
  const classFilter = registers.some(({ token }) => token.uuid === filter.class) ? filter.class : '';
  const found = searchRows(
    classFilter
      ? shareholders.filter((member) => member.holdings.some(({ register }) => register.token.uuid === classFilter))
      : shareholders,
    (member) => [member.name, ...member.holdings.map(({ holder }) => holder.name ?? '')].join(' '),
    filter.search,
  );
  const withoutShares = classFilter
    ? []
    : searchRows(
        people.filter((person) => person.onRegister === false && !person.hasAwards && !person.awardOnly),
        (person) => `${person.name} ${person.residentialAddress}`,
        filter.search,
      );
  const count = found.length + withoutShares.length;
  const page = Math.min(filter.page, Math.max(1, Math.ceil(count / PAGE_SIZE)));
  const start = (page - 1) * PAGE_SIZE;
  const end = page * PAGE_SIZE;
  return {
    shareholders,
    classFilter,
    count,
    visibleClasses: classFilter ? registers.filter(({ token }) => token.uuid === classFilter) : registers,
    shownShareholders: found.slice(start, end),
    shownPeople: withoutShares.slice(Math.max(0, start - found.length), Math.max(0, end - found.length)),
    unresolved: shareholders.filter(({ holdings }) => holdings.some(needsIdentityReview)).length,
  };
}
