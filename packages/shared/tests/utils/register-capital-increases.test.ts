import type {
  RegisterCapitalIncrease,
  RegisterCapitalIncreasePreparation,
  RegisterCapitalIncreaseDecisionPreview,
  RegisterDecideRequest,
} from '../../src/types';
import {
  isPreparedRegisterCapitalIncrease,
  isRegisterCapitalIncreaseDecisionReceipt,
  registerCapitalIncreaseExecutionState,
} from '../../src/utils/register-capital-increases';
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TOKEN = ID(100),
  COMPANY = ID(101),
  DIGEST = 'd'.repeat(64);
const appointment = { uuid: ID(105) };
const token = { name: 'Ordinary shares', symbol: 'ORD', contractAddress: `0x${'2'.repeat(40)}` };
function capitalFrom(body: RegisterCapitalIncreasePreparation): RegisterCapitalIncrease {
  return {
    uuid: body.operationId,
    operationId: body.operationId,
    company: COMPANY,
    token: body.token,
    request: ID(150),
    additionalShares: String(body.additionalShares),
    newAuthorizedTotal: String(body.newAuthorizedTotal),
    purpose: body.purpose,
    boardResolutionReference: body.boardResolutionReference,
    shareholderApprovalReference: body.shareholderApprovalReference ?? '',
    authorityEvidence: body.authorityEvidence,
    evidenceFingerprint: 'a'.repeat(64),
    evidenceSnapshot: {},
    snapshot: {
      company: { uuid: COMPANY, name: 'Synthetic Company', acn: '123456789', status: 'active' },
      token: {
        uuid: TOKEN,
        name: token.name,
        symbol: token.symbol,
        chain: 'base',
        contractAddress: token.contractAddress,
        authorisedShares: '1000',
        decimals: 0,
      },
      capital: {
        priorAuthorizedTotal: '1000',
        additionalShares: String(body.additionalShares),
        newAuthorizedTotal: String(body.newAuthorizedTotal),
        purpose: body.purpose,
        boardResolutionReference: body.boardResolutionReference,
        shareholderApprovalReference: body.shareholderApprovalReference ?? '',
      },
      transaction: {
        chainId: 84532,
        sender: `0x${'6'.repeat(40)}`,
        to: token.contractAddress,
        value: '0',
        data: '0x1234',
      },
    },
    intentDigest: DIGEST,
    preparingAppointment: body.appointment,
    preparedByName: 'Synthetic Preparer',
    providedBy: 'company',
    submittedBy: 1,
    status: 'submitted',
    stage: 'submitted',
    approvalDecision: null,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: '',
    decisions: [],
    createdAt: '2026-10-01T00:00:00Z',
    execution: null,
    executionUnmetRequirements: [],
  };
}
function prepared() {
  return capitalFrom({
    operationId: ID(120),
    appointment: appointment.uuid,
    token: TOKEN,
    additionalShares: 25,
    newAuthorizedTotal: 1025,
    purpose: 'Support future share issues',
    boardResolutionReference: 'BOARD-1',
    shareholderApprovalReference: '',
    authorityEvidence: ID(121),
  });
}
const body: RegisterCapitalIncreasePreparation = {
  operationId: ID(120),
  appointment: appointment.uuid,
  token: TOKEN,
  additionalShares: 25,
  newAuthorizedTotal: 1025,
  purpose: 'Support future share issues',
  boardResolutionReference: 'BOARD-1',
  authorityEvidence: ID(121),
};
const request: RegisterDecideRequest = {
  appointment: appointment.uuid,
  kind: 'approve',
  reason: '',
  previewDigest: DIGEST,
  idempotencyKey: ID(122),
  confirmation: true,
};
function decided(kind: RegisterDecideRequest['kind']) {
  const record = prepared();
  record.decisions = [
    {
      uuid: ID(123),
      appointment: request.appointment,
      kind,
      reason: kind === 'reject' ? 'Company refusal' : '',
      digest: request.previewDigest,
      idempotencyKey: request.idempotencyKey,
      decidedAt: '2026-10-08T00:00:00Z',
      decidedBy: 1,
      decidedByName: 'Synthetic Appointee',
    },
  ];
  record.stage = kind === 'approve' ? 'approved' : kind === 'apply' ? 'applied' : 'rejected';
  if (kind !== 'approve') {
    record.status = kind === 'apply' ? 'applied' : 'rejected';
    record.reviewedAt = record.decisions[0]!.decidedAt;
  }
  if (kind === 'reject') record.rejectionReason = 'Company refusal';
  if (kind === 'apply') {
    record.approvalDecision = ID(124);
    record.execution = {
      execution: ID(125),
      request: record.request,
      dispatchId: ID(126),
      status: 'executing',
      operationId: null,
      claimId: null,
      operationStatus: null,
      transaction: null,
      txHash: null,
      blockNumber: null,
      blockHash: null,
      gasUsed: null,
      projectedAt: null,
      attributionRequired: false,
    };
  }
  return record;
}
function preview(record: RegisterCapitalIncrease): RegisterCapitalIncreaseDecisionPreview {
  return {
    previewDigest: DIGEST,
    canDecide: true,
    unmetRequirements: [],
    snapshot: record.snapshot,
    intentDigest: record.intentDigest,
    priorAuthorizedTotal: record.snapshot.capital.priorAuthorizedTotal,
    additionalShares: record.additionalShares,
    newAuthorizedTotal: record.newAuthorizedTotal,
    approvalDecision: record.approvalDecision,
  };
}
it('matches the genuine preparation to its original captured cap and complete body independently of later class state', () => {
  expect(isPreparedRegisterCapitalIncrease(prepared(), body, COMPANY, '1000')).toBe(true);
  expect(isPreparedRegisterCapitalIncrease(prepared(), body, COMPANY, '1025')).toBe(false);
});
it.each([
  'operationId',
  'appointment',
  'token',
  'authorityEvidence',
  'purpose',
  'boardResolutionReference',
  'shareholderApprovalReference',
] as const)('refuses an original preparation receipt with changed %s', (field) => {
  expect(isPreparedRegisterCapitalIncrease(prepared(), { ...body, [field]: 'changed' }, COMPANY, '1000')).toBe(false);
});
it.each(['priorAuthorizedTotal', 'additionalShares', 'newAuthorizedTotal'] as const)(
  'refuses altered exact capital arithmetic at %s',
  (field) => {
    const record = prepared();
    record.snapshot.capital[field] = '999';
    expect(isPreparedRegisterCapitalIncrease(record, body, COMPANY, '1000')).toBe(false);
  },
);
it.each(['approve', 'apply', 'reject'] as const)(
  'binds the original %s decision, retained snapshot, digest, company appointment and consumed approval',
  (kind) => {
    const record = decided(kind),
      intent = { ...request, kind, reason: kind === 'reject' ? 'Company refusal' : '' },
      shown = preview(record);
    expect(isRegisterCapitalIncreaseDecisionReceipt(record, record.uuid, intent, shown)).toBe(true);
    expect(
      isRegisterCapitalIncreaseDecisionReceipt(record, record.uuid, { ...intent, idempotencyKey: ID(999) }, shown),
    ).toBe(false);
    expect(
      isRegisterCapitalIncreaseDecisionReceipt(record, record.uuid, intent, { ...shown, newAuthorizedTotal: '1026' }),
    ).toBe(false);
    if (kind === 'apply')
      expect(
        isRegisterCapitalIncreaseDecisionReceipt(record, record.uuid, intent, { ...shown, approvalDecision: ID(999) }),
      ).toBe(false);
  },
);
it('separates queued, signed, confirmed and genuine successful projection without treating failed projection stamps as a cap change', () => {
  const record = decided('apply');
  expect(registerCapitalIncreaseExecutionState(record)).toBe('Original capital increase admitted; execution queued');
  record.execution!.operationStatus = 'signed';
  expect(registerCapitalIncreaseExecutionState(record)).toBe('Original transaction signed; confirmation pending');
  record.execution!.operationStatus = 'confirmed';
  expect(registerCapitalIncreaseExecutionState(record)).toBe(
    'Original chain receipt confirmed; finality and projection pending',
  );
  record.execution!.projectedAt = '2026-10-08T00:00:00Z';
  record.execution!.status = 'failed';
  expect(registerCapitalIncreaseExecutionState(record)).toBe('Original execution failed');
  record.execution!.status = 'executed';
  expect(registerCapitalIncreaseExecutionState(record)).toBe(
    'Original execution marked executed; complete original chain receipt unavailable',
  );
  record.execution = {
    ...record.execution!,
    transaction: ID(128),
    txHash: `0x${'3'.repeat(64)}`,
    blockNumber: 5,
    blockHash: `0x${'4'.repeat(64)}`,
  };
  expect(registerCapitalIncreaseExecutionState(record)).toBe('Finalised original cap increase projected');
});
it('retains attribution-required and superseded unsigned history without invented execution', () => {
  const record = decided('apply');
  record.execution!.status = 'superseded';
  record.execution!.projectedAt = '2026-10-08T00:00:00Z';
  expect(registerCapitalIncreaseExecutionState(record)).toBe('Original unsigned increase superseded');
  record.execution!.attributionRequired = true;
  expect(registerCapitalIncreaseExecutionState(record)).toBe(
    'Original execution requires attribution; history retained',
  );
});
