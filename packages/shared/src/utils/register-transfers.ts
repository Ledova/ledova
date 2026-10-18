import type {
  RegisterTransfer,
  RegisterTransferPreparation,
  RegisterDecideRequest,
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
  request: RegisterDecideRequest,
  preview?: RegisterTransferDecisionPreview,
) {
  return (
    isRegisterDecisionReceipt(transfer, uuid, request) &&
    (!preview || transfer.companyEventOn === preview.companyEventOn) &&
    (request.kind !== 'apply' ||
      (!!transfer.registerEntry && !!transfer.companyEventOn && transfer.effectiveOn === transfer.companyEventOn))
  );
}
