import type {
  RegisterTransfer,
  RegisterTransferPreparation,
  RegisterTransferDecideRequest,
  RegisterTransferDecisionPreview,
} from '../types';
import { isRegisterDecisionReceipt } from './register-commands';

export function isPreparedRegisterTransfer(
  transfer: RegisterTransfer,
  request: RegisterTransferPreparation,
  newParticulars: boolean,
) {
  return (
    transfer.uuid === request.operationId &&
    transfer.preparingAppointment === request.appointment &&
    transfer.token === request.tokenId &&
    transfer.fromMember === request.fromMember &&
    transfer.toMember === request.toMember &&
    transfer.newMember === request.newMember &&
    transfer.newParticulars === newParticulars &&
    !!transfer.fromName.trim() &&
    !!transfer.fromResidentialAddress.trim() &&
    !!transfer.name.trim() &&
    !!transfer.residentialAddress.trim() &&
    (!(request.newMember || request.name) || transfer.name === request.name) &&
    (!(request.newMember || request.residentialAddress) ||
      transfer.residentialAddress === request.residentialAddress) &&
    transfer.shares === request.shares &&
    transfer.companyEventOn === request.companyEventOn &&
    transfer.signedOn === request.signedOn &&
    transfer.lodgedOn === request.lodgedOn &&
    transfer.terms === request.terms &&
    transfer.authority === 'director_resolution' &&
    transfer.approvingDirector === request.approvingDirector &&
    transfer.authorityReference === request.authorityReference &&
    transfer.reason === request.reason &&
    transfer.authorityEvidence === request.authorityEvidence &&
    transfer.instrumentEvidence === request.instrumentEvidence &&
    transfer.providedBy === 'company' &&
    (transfer.status !== 'applied' || (!!transfer.registerEntry && transfer.effectiveOn === request.companyEventOn))
  );
}

export function isRegisterTransferDecisionReceipt(
  transfer: RegisterTransfer,
  uuid: string,
  request: RegisterTransferDecideRequest,
  preview?: RegisterTransferDecisionPreview,
) {
  const completed = request.completeTransfer === true;
  const decision = transfer.decisions.find((row) => row.idempotencyKey === request.idempotencyKey);
  if (!completed && (decision?.completeTransfer || preview?.completeTransfer)) return false;
  if (
    completed &&
    (request.kind !== 'approve' ||
      preview?.completeTransfer !== true ||
      preview.applyAppointment !== (request.applyAppointment ?? request.appointment) ||
      decision?.completeTransfer !== true ||
      decision.approvalAppointment !== request.appointment)
  )
    return false;
  return (
    isRegisterDecisionReceipt(
      transfer,
      uuid,
      completed ? { ...request, kind: 'apply', appointment: request.applyAppointment ?? request.appointment } : request,
    ) &&
    (!preview ||
      (transfer.company === preview.company &&
        transfer.token === preview.token &&
        transfer.fromMember === preview.fromMember &&
        transfer.fromName === preview.fromName &&
        transfer.fromResidentialAddress === preview.fromResidentialAddress &&
        transfer.toMember === preview.toMember &&
        transfer.newMember === preview.newMember &&
        transfer.newParticulars === preview.newParticulars &&
        transfer.name === preview.name &&
        transfer.residentialAddress === preview.residentialAddress &&
        transfer.shares === preview.shares &&
        transfer.companyEventOn === preview.companyEventOn &&
        transfer.signedOn === preview.signedOn &&
        transfer.lodgedOn === preview.lodgedOn &&
        transfer.terms === preview.terms &&
        transfer.authority === preview.authority &&
        transfer.approvingDirector === preview.approvingDirector &&
        transfer.authorityReference === preview.authorityReference &&
        transfer.reason === preview.reason &&
        transfer.authorityEvidence === preview.authorityEvidence &&
        transfer.evidenceFingerprint === preview.evidenceFingerprint &&
        transfer.instrumentEvidence === preview.instrumentEvidence &&
        transfer.instrumentFingerprint === preview.instrumentFingerprint)) &&
    ((!completed && request.kind !== 'apply') ||
      (!!transfer.registerEntry &&
        !!transfer.companyEventOn &&
        transfer.effectiveOn === transfer.companyEventOn &&
        (!preview || transfer.effectiveOn === preview.effectiveOn)))
  );
}
