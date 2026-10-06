import { REGISTER_LINK_COPY } from '../constants/business/register-links';
import type { RegisterLink, RegisterLinkPreparation, RegisterLinkRecord, RegisterOpeningLink } from '../types';
import { rowsOf } from './register-commands';
import { sameMapping } from './register-openings';

export function registerLinkOf(record: RegisterLinkRecord): RegisterLink {
  const { mapping } = record;
  if (!rowsOf<RegisterOpeningLink>(mapping, ['address', 'member']))
    throw new Error(REGISTER_LINK_COPY.MAPPING_UNREADABLE);
  return { ...record, mapping };
}

export function isPreparedRegisterLink(link: RegisterLink, request: RegisterLinkPreparation) {
  return (
    link.uuid === request.operationId &&
    link.company === request.companyId &&
    link.preparingAppointment === request.appointment &&
    link.authorityEvidence === request.authorityEvidence &&
    link.authority === request.authority &&
    link.approvingDirector === (request.approvingDirector ?? '') &&
    link.authorityReference === request.authorityReference &&
    link.reason === request.reason &&
    link.providedBy === 'company' &&
    sameMapping(link.mapping, request.mapping)
  );
}
