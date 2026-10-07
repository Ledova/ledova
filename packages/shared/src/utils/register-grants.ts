import type { RegisterGrant, RegisterGrantPreparation, RegisterDecideRequest } from '../types';
import { isRegisterDecisionReceipt } from './register-commands';

export function isPreparedRegisterGrant(grant: RegisterGrant, request: RegisterGrantPreparation) {
  return (
    grant.uuid === request.operationId &&
    grant.preparingAppointment === request.appointment &&
    grant.token === request.tokenId &&
    grant.member === request.member &&
    grant.newMember === request.newMember &&
    !!grant.name.trim() &&
    !!grant.residentialAddress.trim() &&
    (!(request.newMember || request.name) || grant.name === request.name) &&
    (!(request.newMember || request.residentialAddress) || grant.residentialAddress === request.residentialAddress) &&
    grant.shares === request.shares &&
    grant.termsOn === request.termsOn &&
    grant.approvingDirector === request.approvingDirector &&
    grant.terms === request.terms &&
    grant.authorityReference === request.authorityReference &&
    grant.reason === request.reason &&
    grant.authorityEvidence === request.authorityEvidence &&
    grant.termsEvidence === request.termsEvidence &&
    grant.acceptanceRequired === request.acceptanceRequired &&
    grant.acceptanceEvidence === (request.acceptanceEvidence ?? null) &&
    grant.providedBy === 'company' &&
    (grant.status !== 'applied' || (!!grant.registerEntry && !!grant.effectiveOn))
  );
}

export function isRegisterGrantDecisionReceipt(grant: RegisterGrant, uuid: string, request: RegisterDecideRequest) {
  return (
    isRegisterDecisionReceipt(grant, uuid, request) &&
    (request.kind !== 'apply' || (!!grant.registerEntry && !!grant.effectiveOn))
  );
}
