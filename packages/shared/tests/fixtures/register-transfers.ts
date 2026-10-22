import type { RegisterTransfer, RegisterTransferDecisionPreview, RegisterTransferDecideRequest } from '../../src';
import { APPOINTMENT } from './employee-awards';

export const TRANSFER: RegisterTransfer = {
  uuid: 'transfer-a',
  company: APPOINTMENT.company,
  token: 'ordinary',
  fromMember: 'shareholder-a',
  fromName: 'Synthetic Shareholder',
  fromResidentialAddress: '1 Synthetic Street, Sydney NSW 2000',
  fromParticulars: {},
  toMember: 'recipient-a',
  name: 'Synthetic Recipient',
  residentialAddress: '2 Synthetic Street, Sydney NSW 2000',
  toParticulars: {},
  newMember: false,
  newParticulars: false,
  shares: '100',
  companyEventOn: '2026-10-22',
  signedOn: '2026-10-21',
  lodgedOn: '2026-10-22',
  terms: 'Gift of 100 ORD shares for no consideration',
  authority: 'director_resolution',
  approvingDirector: 'Synthetic Director',
  authorityReference: 'Company approval A',
  reason: 'Company-approved gift',
  authorityEvidence: 'authority-a',
  evidenceFingerprint: 'a'.repeat(64),
  evidenceSnapshot: {},
  instrumentEvidence: 'instrument-a',
  instrumentFingerprint: 'b'.repeat(64),
  instrumentSnapshot: {},
  preparingAppointment: APPOINTMENT.uuid,
  preparedByName: 'Synthetic Preparer',
  providedBy: 'company',
  submittedBy: 1,
  status: 'submitted',
  stage: 'submitted',
  registerEntry: null,
  effectiveOn: null,
  reviewedBy: null,
  reviewedAt: null,
  rejectionReason: '',
  decisions: [],
  createdAt: '2026-10-22T00:00:00Z',
};

export const TRANSFER_PREVIEW: RegisterTransferDecisionPreview = {
  ...TRANSFER,
  effectiveOn: TRANSFER.companyEventOn,
  previewDigest: 'c'.repeat(64),
  completeTransfer: false,
  applyAppointment: null,
  canDecide: true,
  unmetRequirements: [],
  registerSequence: 1,
  fromCurrentShares: '8000',
  fromAfterShares: '7900',
  toCurrentShares: '0',
  toAfterShares: '100',
  issuedSupply: '8100',
  afterIssuedSupply: '8100',
  authorisedSupply: '10000',
};

export function transferDecision(request: RegisterTransferDecideRequest): RegisterTransfer {
  const completed = request.completeTransfer === true;
  const applied = completed || request.kind === 'apply';
  const decidedAt = '2026-10-22T01:00:00Z';
  return {
    ...TRANSFER,
    decisions: [
      {
        uuid: 'transfer-decision-a',
        appointment: completed ? (request.applyAppointment ?? request.appointment) : request.appointment,
        kind: completed ? 'apply' : request.kind,
        digest: request.previewDigest,
        idempotencyKey: request.idempotencyKey,
        reason: request.reason ?? '',
        decidedAt,
        decidedBy: 1,
        decidedByName: 'Synthetic Appointee',
        completeTransfer: completed,
        approvalAppointment: completed ? request.appointment : null,
      },
    ],
    ...(applied
      ? {
          status: 'applied',
          stage: 'applied',
          registerEntry: 'transfer-entry-a',
          effectiveOn: TRANSFER.companyEventOn,
          reviewedAt: decidedAt,
          reviewedBy: 1,
        }
      : { stage: 'approved' }),
  };
}
