import type {
  CompanyShareToken,
  OwnCompanyAppointment,
  RegisterPaidIssue,
  RegisterPaidIssueSource,
  RegisterPaidIssuePreparation,
  RegisterPaidIssueDecisionPreview,
  RegisterDecideRequest,
} from '../../src/types';
import {
  isRegisterPaidIssueSource,
  isPreparedRegisterPaidIssue,
  isRegisterPaidIssueDecisionReceipt,
  registerPaidIssueExecutionState,
} from '../../src/utils/register-paid-issues';
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TOKEN = ID(100),
  COMPANY = ID(101),
  DIGEST = 'd'.repeat(64);
const appointment: OwnCompanyAppointment = {
  uuid: ID(105),
  company: COMPANY,
  companyName: 'Synthetic Company',
  capabilities: ['admin'],
  delegatableCapabilities: [],
  status: 'active',
  isEffective: true,
  expiresAt: null,
  revokedAt: null,
  createdAt: '2026-10-01T00:00:00Z',
  source: 'invitation',
  declarationText: null,
  declarationVersion: null,
};
const token: CompanyShareToken = {
  uuid: TOKEN,
  company: COMPANY,
  companyUuid: COMPANY,
  companyName: 'Synthetic Company',
  name: 'Ordinary shares',
  symbol: 'ORD',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  tokenType: 'ordinary',
  deployedAt: null,
  deploymentTxHash: null,
  status: 'deployed',
  statusDisplay: 'Deployed',
  tokenTypeDisplay: 'Ordinary',
  totalSupply: '1000',
  decimals: 0,
  isTransferable: true,
  isDivisible: false,
  isOwner: false,
  chain: 'base',
  contractAddress: `0x${'2'.repeat(40)}`,
};
const paidSource: RegisterPaidIssueSource = {
  subscription: ID(110),
  offering: ID(111),
  company: COMPANY,
  token: TOKEN,
  recipientAddress: `0x${'7'.repeat(40)}`,
  recipientName: 'Synthetic Investor',
  shares: '7',
  requestedShares: '10',
  currency: 'aud',
  pricePerShare: '2.00',
  amountDue: '20.00',
  amountReceived: '15.00',
  moneyHeld: '15.00',
  paymentReceivedOn: '2026-10-01',
  paymentReferenceSeen: 'PAY-1',
  paymentTxHash: null,
  paymentConfirmedAt: '2026-10-01T00:00:00Z',
  refundAmount: '1.00',
  refundedAt: null,
};

const sources = [paidSource];
function paidFrom(body: RegisterPaidIssuePreparation): RegisterPaidIssue {
  if (!token.contractAddress) throw new Error('Invalid fixture contract');
  const captured = sources.find((row) => row.subscription === body.subscription) ?? paidSource;
  return {
    uuid: body.operationId,
    operationId: body.operationId,
    company: COMPANY,
    token: captured.token,
    subscription: body.subscription,
    request: null,
    shares: captured.shares,
    subscriptionStatus: 'paid',
    allottedAt: null,
    approvingDirector: body.approvingDirector,
    reason: body.reason ?? '',
    authorityReference: body.authorityReference,
    authorityEvidence: body.authorityEvidence,
    evidenceFingerprint: 'a'.repeat(64),
    evidenceSnapshot: {},
    snapshot: {
      company: { uuid: COMPANY, name: 'Synthetic Company', acn: '123456789', status: 'active' },
      token: {
        uuid: captured.token,
        name: token.name,
        symbol: token.symbol,
        chain: 'base',
        contractAddress: token.contractAddress,
        authorisedShares: '1000',
      },
      source: structuredClone(captured),
      register: { present: true, uuid: ID(115), sequence: 3, headHash: DIGEST, issuedSupply: '10' },
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
  return paidFrom({
    operationId: ID(120),
    appointment: appointment.uuid,
    subscription: paidSource.subscription,
    approvingDirector: 'Synthetic Director',
    reason: 'Approve recorded paid allotment',
    authorityReference: 'BOARD-1',
    authorityEvidence: ID(121),
  });
}

const body: RegisterPaidIssuePreparation = {
  operationId: ID(120),
  appointment: appointment.uuid,
  subscription: paidSource.subscription,
  approvingDirector: 'Synthetic Director',
  reason: 'Approve recorded paid allotment',
  authorityReference: 'BOARD-1',
  authorityEvidence: ID(121),
};
function preview(record: RegisterPaidIssue): RegisterPaidIssueDecisionPreview {
  if (
    typeof record.intentDigest !== 'string' ||
    typeof record.shares !== 'string' ||
    typeof record.approvingDirector !== 'string' ||
    typeof record.authorityReference !== 'string' ||
    typeof record.reason !== 'string'
  )
    throw new Error('Invalid fixture');
  return {
    previewDigest: DIGEST,
    canDecide: true,
    unmetRequirements: [],
    snapshot: record.snapshot,
    intentDigest: record.intentDigest,
    approvalDecision: record.approvalDecision,
    shares: record.shares,
    approvingDirector: record.approvingDirector,
    reason: record.reason,
    authorityReference: record.authorityReference,
    offeringHeadroom: '100',
    issuedSupply: '10',
    reservedShares: '0',
    authorisedSupply: '1000',
    availableShares: '990',
  };
}
function admitted() {
  const record = prepared();
  record.request = ID(140);
  record.approvalDecision = ID(124);
  record.status = 'applied';
  record.stage = 'applied';
  record.execution = {
    execution: ID(141),
    request: record.request,
    dispatchId: ID(142),
    status: 'queued',
    issuance: null,
    operationId: null,
    claimId: null,
    operationStatus: null,
    transaction: null,
    txHash: null,
    blockNumber: null,
    blockHash: null,
    completedAt: null,
    registerEntry: null,
    effectiveOn: null,
  };
  return record;
}
it('accepts actual partial paid terms and residual refund owed without fabricating payment coverage, identity or refund completion', () => {
  expect(isRegisterPaidIssueSource(paidSource, COMPANY, TOKEN)).toBe(true);
  expect(
    isRegisterPaidIssueSource(
      { ...paidSource, recipientName: '', amountReceived: null, refundAmount: null },
      COMPANY,
      TOKEN,
    ),
  ).toBe(true);
  for (const changed of [
    { company: ID(999) },
    { token: ID(999) },
    { shares: '0' },
    { shares: '2147483648' },
    { shares: '1.5' },
    { recipientAddress: 'foreign' },
    { moneyHeld: 'NaN' },
  ])
    expect(isRegisterPaidIssueSource({ ...paidSource, ...changed }, COMPANY, TOKEN)).toBe(false);
});
it('binds exact submitted preparation and nullable pre-APPLY request while accepting the server original derived source snapshot', () => {
  const record = prepared();
  expect(record.request).toBeNull();
  expect(isPreparedRegisterPaidIssue(record, body, paidSource, token)).toBe(true);
  const locked = {
    ...record,
    snapshot: {
      ...record.snapshot,
      source: { ...record.snapshot.source, amountReceived: '17.00', moneyHeld: '17.00' },
    },
  };
  expect(isPreparedRegisterPaidIssue(locked, body, paidSource, token)).toBe(true);
  for (const changed of [
    { operationId: ID(999) },
    { preparingAppointment: ID(999) },
    { subscription: ID(999) },
    { approvingDirector: 'Other Director' },
    { reason: 'Other reason' },
    { authorityReference: 'Other reference' },
    { authorityEvidence: ID(999) },
    { intentDigest: 'malformed' },
    { status: 'applied' as const },
  ])
    expect(isPreparedRegisterPaidIssue({ ...record, ...changed }, body, paidSource, token)).toBe(false);
});
it('requires exact decision body, consumed approval and original request/execution association for all decision receipts', () => {
  for (const kind of ['approve', 'apply', 'reject'] as const) {
    const record = kind === 'apply' ? admitted() : prepared();
    const request: RegisterDecideRequest = {
      appointment: appointment.uuid,
      kind,
      reason: kind === 'reject' ? 'Company refusal' : '',
      previewDigest: DIGEST,
      idempotencyKey: ID(122),
      confirmation: true,
    };
    record.decisions = [
      {
        uuid: ID(123),
        appointment: request.appointment,
        kind,
        reason: request.reason!,
        digest: DIGEST,
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
    if (kind === 'reject') record.rejectionReason = request.reason!;
    const shown = preview(record);
    expect(isRegisterPaidIssueDecisionReceipt(record, record.uuid, request, shown)).toBe(true);
    expect(
      isRegisterPaidIssueDecisionReceipt(record, record.uuid, { ...request, idempotencyKey: ID(999) }, shown),
    ).toBe(false);
    expect(isRegisterPaidIssueDecisionReceipt(record, record.uuid, request, { ...shown, shares: '8' })).toBe(false);
    if (kind === 'apply') {
      expect(
        isRegisterPaidIssueDecisionReceipt(record, record.uuid, request, { ...shown, approvalDecision: ID(999) }),
      ).toBe(false);
      expect(
        isRegisterPaidIssueDecisionReceipt(
          { ...record, execution: { ...record.execution!, request: ID(999) } },
          record.uuid,
          request,
          shown,
        ),
      ).toBe(false);
    }
    if (kind === 'approve') {
      const later = admitted();
      record.status = 'applied';
      record.stage = 'applied';
      record.request = later.request;
      record.approvalDecision = record.decisions[0]!.uuid;
      record.execution = later.execution;
      expect(isRegisterPaidIssueDecisionReceipt(record, record.uuid, request, shown)).toBe(true);
    }
  }
});
it('does not infer Mint or register inclusion from payment, allotment, supply or incomplete original confirmation', () => {
  const record = admitted();
  record.subscriptionStatus = 'allotted';
  record.allottedAt = '2026-10-08T00:01:00Z';
  expect(registerPaidIssueExecutionState(record)).toBe('Original paid issue admitted; execution queued');
  record.execution = {
    ...record.execution!,
    status: 'executed',
    issuance: ID(150),
    operationId: ID(151),
    claimId: ID(152),
    transaction: ID(153),
    operationStatus: 'confirmed',
    txHash: `0x${'3'.repeat(64)}`,
    blockNumber: 7,
    blockHash: `0x${'4'.repeat(64)}`,
    completedAt: '2026-10-08T00:02:00Z',
  };
  expect(registerPaidIssueExecutionState(record)).toBe('Finalised original paid mint; register entry not recorded');
  for (const changed of [
    { txHash: null },
    { blockHash: null },
    { blockNumber: null },
    { operationId: null },
    { claimId: null },
    { transaction: null },
    { issuance: null },
    { completedAt: null },
  ])
    expect(registerPaidIssueExecutionState({ ...record, execution: { ...record.execution, ...changed } })).toBe(
      'Original marked executed; complete original mint receipt unavailable',
    );
  record.execution.registerEntry = ID(154);
  record.execution.effectiveOn = '2026-10-08';
  expect(registerPaidIssueExecutionState(record)).toBe('Finalised original paid mint recorded in the register');
});
it('keeps never-signed source loss, cancellation, failure, signed and reverted originals separate without implying refunds', () => {
  const record = admitted();
  record.executionUnmetRequirements = ['company_source_expired'];
  expect(registerPaidIssueExecutionState(record)).toBe('Original unsigned paid issue held');
  const original = record.execution!;
  for (const [changed, label] of [
    [{ status: 'cancelled' }, 'Original unsigned execution cancelled; paid allocation remains bound'],
    [{ status: 'failed' }, 'Original paid issue execution failed'],
    [{ operationStatus: 'reverted' }, 'Original transaction reverted'],
    [{ operationStatus: 'signed' }, 'Original transaction signed; confirmation pending'],
    [{ operationStatus: 'confirmed' }, 'Original chain receipt confirmed; finality and projection pending'],
    [{ request: ID(999) }, 'Original paid issue receipt does not identify this request'],
  ] as const)
    expect(registerPaidIssueExecutionState({ ...record, execution: { ...original, ...changed } })).toBe(label);
});

it.each(
  [false, true].flatMap((recorded) =>
    [
      ['date array', ['2026-10-08T00:02:00Z']],
      ['number', 1],
    ].map(([valueName, value]) => [recorded, valueName, value] as const),
  ),
)(
  'refuses a finalised paid mint label with register recorded=%s and a coercible %s timestamp',
  (recorded, _name, value) => {
    const record = admitted();
    record.execution = {
      ...record.execution!,
      status: 'executed',
      issuance: ID(150),
      operationId: ID(151),
      claimId: ID(152),
      transaction: ID(153),
      operationStatus: 'confirmed',
      txHash: `0x${'3'.repeat(64)}`,
      blockNumber: 7,
      blockHash: `0x${'4'.repeat(64)}`,
      completedAt: value as unknown as string,
      registerEntry: recorded ? ID(154) : null,
      effectiveOn: recorded ? '2026-10-08' : null,
    };
    expect(registerPaidIssueExecutionState(record)).toBe(
      'Original marked executed; complete original mint receipt unavailable',
    );
  },
);

it('requires primitive original receipt identities and keeps malformed register references separate from a genuine mint', () => {
  const record = admitted();
  const execution = {
    ...record.execution!,
    status: 'executed' as const,
    issuance: ID(150),
    operationId: ID(151),
    claimId: ID(152),
    transaction: ID(153),
    operationStatus: 'confirmed' as const,
    txHash: `0x${'3'.repeat(64)}`,
    blockNumber: 7,
    blockHash: `0x${'4'.repeat(64)}`,
    completedAt: '2026-10-08T00:02:00Z',
    registerEntry: ID(154),
    effectiveOn: '2026-10-08',
  };
  const invalid = [[], [ID(999)], 42, true, {}, null, '', ' '];
  expect(registerPaidIssueExecutionState({ ...record, execution })).toBe(
    'Finalised original paid mint recorded in the register',
  );
  for (const field of ['execution', 'dispatchId', 'issuance', 'operationId', 'claimId', 'transaction'] as const)
    for (const value of invalid)
      expect(registerPaidIssueExecutionState({ ...record, execution: { ...execution, [field]: value } })).toBe(
        'Original marked executed; complete original mint receipt unavailable',
      );
  for (const value of [42, true, null, '', ' '])
    expect(
      registerPaidIssueExecutionState({
        ...record,
        request: value as unknown as string,
        execution: { ...execution, request: value as unknown as string },
      }),
    ).toBe('Original paid issue receipt does not identify this request');
  for (const field of ['registerEntry', 'effectiveOn'] as const)
    for (const value of invalid)
      expect(registerPaidIssueExecutionState({ ...record, execution: { ...execution, [field]: value } })).toBe(
        'Finalised original paid mint; register entry not recorded',
      );
  expect(registerPaidIssueExecutionState({ ...record, execution: { ...execution, effectiveOn: 'not a date' } })).toBe(
    'Finalised original paid mint; register entry not recorded',
  );
});
