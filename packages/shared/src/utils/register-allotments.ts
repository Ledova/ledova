import type {
  RegisterAllotment,
  RegisterAllotmentPreparation,
  RegisterAllotmentDecisionPreview,
  RegisterDecideRequest,
} from '../types';
import { isRegisterDecisionReceipt } from './register-commands';

export function allotmentAud(value: string) {
  const match = /^(0|[1-9]\d{0,17})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const whole = match[1]!;
  const decimals = (match[2] ?? '').padEnd(2, '0');
  if (BigInt(whole) * 100n + BigInt(decimals) === 0n) return null;
  return `${whole}.${decimals}`;
}

export function isPreparedRegisterAllotment(
  allotment: RegisterAllotment,
  request: RegisterAllotmentPreparation,
  company: string,
) {
  return (
    allotment.uuid === request.operationId &&
    allotment.company === company &&
    allotment.token === request.tokenId &&
    allotment.preparingAppointment === request.appointment &&
    allotment.member === request.member &&
    allotment.newMember === request.newMember &&
    !!allotment.name.trim() &&
    !!allotment.residentialAddress.trim() &&
    (!request.newMember ||
      (allotment.name === request.name && allotment.residentialAddress === request.residentialAddress)) &&
    allotment.shares === request.shares &&
    allotment.currency === 'AUD' &&
    request.currency === 'AUD' &&
    allotmentAud(allotment.consideration) === allotmentAud(request.consideration) &&
    allotmentAud(request.consideration) !== null &&
    allotment.agreement.reference === request.agreementReference &&
    allotment.agreement.agreedOn === request.agreementOn &&
    allotment.agreement.terms === request.terms &&
    allotment.agreement.evidence === request.agreementEvidence &&
    /^[0-9a-f]{64}$/.test(allotment.agreement.evidenceFingerprint) &&
    allotment.contribution.companyRecorded === true &&
    allotment.contribution.currency === 'AUD' &&
    allotmentAud(allotment.contribution.amount) === allotmentAud(request.receivedAmount) &&
    allotmentAud(request.receivedAmount) === allotmentAud(request.consideration) &&
    allotment.contribution.receivedOn === request.receivedOn &&
    allotment.contribution.evidence === request.receiptEvidence &&
    /^[0-9a-f]{64}$/.test(allotment.contribution.evidenceFingerprint) &&
    allotment.approvingDirector === request.approvingDirector &&
    allotment.authorityReference === request.authorityReference &&
    allotment.reason === request.reason &&
    allotment.authorityEvidence === request.authorityEvidence &&
    allotment.providedBy === 'company' &&
    (allotment.status !== 'applied' || (!!allotment.registerEntry && !!allotment.effectiveOn))
  );
}

export function isRegisterAllotmentDecisionReceipt(
  allotment: RegisterAllotment,
  uuid: string,
  request: RegisterDecideRequest,
  preview?: RegisterAllotmentDecisionPreview,
) {
  return (
    isRegisterDecisionReceipt(allotment, uuid, request) &&
    (!preview ||
      (allotment.member === preview.member &&
        allotment.name === preview.name &&
        allotment.residentialAddress === preview.residentialAddress &&
        allotment.shares === preview.shares &&
        allotment.consideration === preview.consideration &&
        allotment.currency === preview.currency &&
        allotment.approvingDirector === preview.approvingDirector &&
        allotment.authorityReference === preview.authorityReference &&
        allotment.reason === preview.reason &&
        allotment.agreement.uuid === preview.agreement.uuid &&
        allotment.agreement.reference === preview.agreement.reference &&
        allotment.agreement.agreedOn === preview.agreement.agreedOn &&
        allotment.agreement.terms === preview.agreement.terms &&
        allotment.agreement.evidenceFingerprint === preview.agreement.evidenceFingerprint &&
        allotment.contribution.uuid === preview.contribution.uuid &&
        allotment.contribution.companyRecorded === true &&
        allotment.contribution.currency === 'AUD' &&
        allotment.contribution.amount === preview.contribution.amount &&
        allotment.contribution.receivedOn === preview.contribution.receivedOn &&
        allotment.contribution.evidenceFingerprint === preview.contribution.evidenceFingerprint)) &&
    (request.kind !== 'apply' || (!!allotment.registerEntry && allotment.effectiveOn === preview?.effectiveOn))
  );
}
