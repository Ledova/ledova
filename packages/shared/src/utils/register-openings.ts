import { REGISTER_OPENING_COPY, REGISTER_OPENING_HOLDINGS_MOVED_CODE } from '../constants/business/register-openings';
import type {
  RegisterOpening,
  RegisterOpeningHolder,
  RegisterOpeningLink,
  RegisterOpeningPreparation,
  RegisterOpeningRecord,
} from '../types';
import { failureStatus, rowsOf } from './register-commands';

type Holding = Pick<RegisterOpeningHolder, 'address' | 'shares'>;
type MappedHolding = Pick<RegisterOpeningHolder, 'member' | 'memberName' | 'memberExists'>;

export function registerOpeningOf(record: RegisterOpeningRecord): RegisterOpening {
  const { mapping } = record;
  if (!rowsOf<RegisterOpeningLink>(mapping, ['address', 'member']))
    throw new Error(REGISTER_OPENING_COPY.MAPPING_UNREADABLE);
  return { ...record, mapping };
}

function links(mapping: RegisterOpeningLink[]) {
  return JSON.stringify(
    mapping
      .map(({ address, member }): [string, string] => [address.toLowerCase(), member.toLowerCase()])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function isPreparedRegisterOpening(proposal: RegisterOpening, request: RegisterOpeningPreparation) {
  return (
    proposal.uuid === request.operationId &&
    proposal.token === request.tokenId &&
    proposal.preparingAppointment === request.appointment &&
    proposal.authorityEvidence === request.authorityEvidence &&
    proposal.authority === request.authority &&
    proposal.approvingDirector === (request.approvingDirector ?? '') &&
    proposal.authorityReference === request.authorityReference &&
    proposal.reason === request.reason &&
    proposal.providedBy === 'company' &&
    links(proposal.mapping) === links(request.mapping)
  );
}

export function largestHoldingsFirst<Row extends Holding>(holdings: readonly Row[]) {
  return [...holdings].sort((left, right) => {
    const difference = BigInt(right.shares) - BigInt(left.shares);
    if (difference !== 0n) return difference > 0n ? 1 : -1;
    const [first, second] = [left.address.toLowerCase(), right.address.toLowerCase()];
    return first < second ? -1 : first > second ? 1 : 0;
  });
}

export function hasWholeShares(holdings: readonly Pick<Holding, 'shares'>[]) {
  return holdings.every(({ shares }) => /^\d+$/.test(shares));
}

export function openingMemberLabels(holdings: readonly MappedHolding[]) {
  const labels = new Map<string, string>();
  let unnamed = 0;
  let fresh = 0;
  for (const { member, memberName, memberExists } of holdings) {
    if (member === null || labels.has(member)) continue;
    labels.set(
      member,
      memberName ??
        (memberExists
          ? REGISTER_OPENING_COPY.UNNAMED_MEMBER_NUMBERED(++unnamed)
          : REGISTER_OPENING_COPY.NEW_MEMBER_NUMBERED(++fresh)),
    );
  }
  return labels;
}

export function isRegisterOpeningHoldingsMoved(failure: unknown) {
  const code = (failure as { response?: { data?: { code?: unknown } } } | null)?.response?.data?.code;
  return failureStatus(failure) === 400 && code === REGISTER_OPENING_HOLDINGS_MOVED_CODE;
}
