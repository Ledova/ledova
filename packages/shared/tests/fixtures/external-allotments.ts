import type {
  RegisterAllotment,
  RegisterAllotmentPreparation,
  RegisterAllotmentDecisionPreview,
  RegisterAllotmentDecideRequest,
} from '../../src';
import { APPOINTMENT } from './employee-awards';

export const ALLOTMENT_REQUEST: RegisterAllotmentPreparation = {
  operationId: 'allotment-a',
  appointment: APPOINTMENT.uuid,
  tokenId: 'ordinary',
  member: 'investor-a',
  newMember: true,
  name: 'Synthetic Investor',
  residentialAddress: '1 Synthetic Street, Sydney NSW 2000',
  shares: '100',
  companyEventOn: '2026-10-11',
  consideration: '250.00',
  currency: 'AUD',
  agreementReference: 'External arrangement A',
  agreementOn: '2020-01-01',
  terms: 'Fully paid external allotment',
  agreementEvidence: 'agreement-a',
  receivedAmount: '250.00',
  receivedOn: '2020-01-02',
  receiptEvidence: 'receipt-a',
  approvingDirector: 'Synthetic Director',
  authorityReference: 'Company approval A',
  reason: 'External capital',
  authorityEvidence: 'authority-a',
};

export function allotmentFrom(body: RegisterAllotmentPreparation): RegisterAllotment {
  return {
    uuid: body.operationId,
    company: APPOINTMENT.company,
    token: body.tokenId,
    member: body.member,
    newMember: body.newMember,
    name: body.name || 'Retained Investor',
    residentialAddress: body.residentialAddress || ALLOTMENT_REQUEST.residentialAddress!,
    shares: body.shares,
    companyEventOn: body.companyEventOn,
    consideration: body.consideration,
    currency: body.currency,
    agreement: {
      uuid: `agreement-${body.operationId}`,
      reference: body.agreementReference,
      agreedOn: body.agreementOn,
      terms: body.terms,
      evidence: body.agreementEvidence,
      evidenceFingerprint: 'a'.repeat(64),
      evidenceSnapshot: {},
      recordedBy: 1,
      recordedAt: '2026-10-07T00:00:00Z',
    },
    contribution: {
      uuid: `contribution-${body.operationId}`,
      amount: body.receivedAmount,
      currency: body.currency,
      receivedOn: body.receivedOn,
      evidence: body.receiptEvidence,
      evidenceFingerprint: 'a'.repeat(64),
      evidenceSnapshot: {},
      recordedBy: 1,
      recordedAt: '2026-10-07T00:00:00Z',
      companyRecorded: true,
    },
    approvingDirector: body.approvingDirector,
    authorityReference: body.authorityReference,
    reason: body.reason,
    authorityEvidence: body.authorityEvidence,
    evidenceFingerprint: 'a'.repeat(64),
    evidenceSnapshot: {},
    preparingAppointment: body.appointment,
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
    createdAt: '2026-10-07T00:00:00Z',
  };
}

export function allotmentPreview(row: RegisterAllotment): RegisterAllotmentDecisionPreview {
  return {
    ...row,
    effectiveOn: row.companyEventOn,
    previewDigest: 'b'.repeat(64),
    completeIssue: false,
    applyAppointment: null,
    canDecide: true,
    unmetRequirements: [],
    registerSequence: 1,
    className: 'Ordinary shares',
    classCode: 'ORD',
    currentHolders: [],
    currentShares: '0',
    afterShares: row.shares,
    issuedSupply: '0',
    afterIssuedSupply: row.shares,
    authorisedSupply: '1000',
  };
}

export function allotmentDecision(row: RegisterAllotment, body: RegisterAllotmentDecideRequest): RegisterAllotment {
  if (body.kind === 'approve' && body.completeIssue) {
    const approved =
      row.stage === 'approved'
        ? row
        : allotmentDecision(row, { ...body, completeIssue: false, idempotencyKey: `approval-${body.idempotencyKey}` });
    const applied = allotmentDecision(approved, {
      ...body,
      kind: 'apply',
      completeIssue: false,
      appointment: body.applyAppointment ?? body.appointment,
    });
    return {
      ...applied,
      decisions: applied.decisions.map((decision) =>
        decision.idempotencyKey === body.idempotencyKey
          ? { ...decision, completeIssue: true, approvalAppointment: body.appointment }
          : decision,
      ),
    };
  }
  const decidedAt = '2026-10-11T00:00:00Z';
  return {
    ...row,
    decisions: [
      ...row.decisions,
      {
        uuid: body.idempotencyKey,
        appointment: body.appointment,
        kind: body.kind,
        digest: body.previewDigest,
        idempotencyKey: body.idempotencyKey,
        reason: body.reason || '',
        decidedAt,
        decidedBy: 1,
        decidedByName: 'Synthetic Appointee',
        completeIssue: false,
        approvalAppointment: null,
      },
    ],
    ...(body.kind === 'apply'
      ? {
          status: 'applied',
          stage: 'applied',
          registerEntry: 'entry-a',
          effectiveOn: row.companyEventOn,
          reviewedAt: decidedAt,
          reviewedBy: 1,
        }
      : { stage: 'approved' }),
  };
}
