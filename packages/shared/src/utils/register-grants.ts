import type {
  RegisterGrant,
  RegisterGrantPreparation,
  RegisterGrantDecisionPreview,
  RegisterDecideRequest,
} from '../types';
import { isRegisterDecisionReceipt } from './register-commands';

export function isPreparedRegisterGrant(
  grant: RegisterGrant,
  request: RegisterGrantPreparation,
  expectedTermsFingerprint?: string,
) {
  return (
    grant.uuid === request.operationId &&
    grant.preparingAppointment === request.appointment &&
    grant.token === request.tokenId &&
    (grant.award ?? null) === (request.award ?? null) &&
    grant.member === request.member &&
    grant.newMember === request.newMember &&
    !!grant.name.trim() &&
    !!grant.residentialAddress.trim() &&
    (!(request.newMember || request.name) || grant.name === request.name) &&
    (!(request.newMember || request.residentialAddress) || grant.residentialAddress === request.residentialAddress) &&
    grant.shares === request.shares &&
    grant.companyEventOn === request.companyEventOn &&
    grant.termsOn === request.termsOn &&
    grant.approvingDirector === request.approvingDirector &&
    grant.terms === request.terms &&
    grant.authorityReference === request.authorityReference &&
    grant.reason === request.reason &&
    grant.authorityEvidence === request.authorityEvidence &&
    grant.termsEvidence === request.termsEvidence &&
    (expectedTermsFingerprint === undefined ||
      (typeof expectedTermsFingerprint === 'string' &&
        /^[0-9a-f]{64}$/.test(expectedTermsFingerprint) &&
        grant.termsFingerprint === expectedTermsFingerprint)) &&
    grant.acceptanceRequired === request.acceptanceRequired &&
    grant.acceptanceEvidence === (request.acceptanceEvidence ?? null) &&
    grant.providedBy === 'company' &&
    (grant.status !== 'applied' || (!!grant.registerEntry && grant.effectiveOn === request.companyEventOn))
  );
}

export function isRegisterGrantDecisionReceipt(
  grant: RegisterGrant,
  uuid: string,
  request: RegisterDecideRequest,
  preview?: RegisterGrantDecisionPreview,
) {
  return (
    isRegisterDecisionReceipt(grant, uuid, request) &&
    (!preview ||
      ((grant.award ?? null) === (preview.award ?? null) && grant.companyEventOn === preview.companyEventOn)) &&
    (request.kind !== 'apply' ||
      (!!grant.registerEntry && !!grant.companyEventOn && grant.effectiveOn === grant.companyEventOn))
  );
}
