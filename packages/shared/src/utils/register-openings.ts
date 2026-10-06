import { REGISTER_OPENING_COPY } from '../constants/business/register-openings';
import type { RegisterOpening, RegisterOpeningLink, RegisterOpeningPreparation, RegisterOpeningRecord } from '../types';
import { rowsOf } from './register-commands';

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
