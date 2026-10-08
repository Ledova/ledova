import type {
  RegisterPauseChange,
  RegisterPauseChangePreparation,
  RegisterPauseChangeDecisionPreview,
  RegisterDecideRequest,
} from '../../src/types';
import {
  isPreparedRegisterPauseChange,
  isRegisterPauseChangeDecisionReceipt,
  registerPauseChangeExecutionState,
} from '../../src/utils/register-pause-changes';
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TOKEN = ID(100),
  COMPANY = ID(101),
  DIGEST = 'd'.repeat(64);
const appointment = { uuid: ID(105) };
const token = { name: 'Ordinary shares', symbol: 'ORD', contractAddress: `0x${'2'.repeat(40)}` };
function pauseFrom(body: RegisterPauseChangePreparation): RegisterPauseChange {
  return {
    uuid: body.operationId,
    operationId: body.operationId,
    company: COMPANY,
    token: body.token,
    paused: body.paused,
    reason: body.reason,
    authorityReference: body.authorityReference,
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
  return pauseFrom({
    operationId: ID(120),
    appointment: appointment.uuid,
    token: TOKEN,
    paused: true,
    reason: 'Temporary company restriction',
    authorityReference: 'BOARD-1',
    authorityEvidence: ID(121),
  });
}

const body: RegisterPauseChangePreparation = {
  operationId: ID(120),
  appointment: appointment.uuid,
  token: TOKEN,
  paused: true,
  reason: 'Temporary company restriction',
  authorityReference: 'BOARD-1',
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
function preview(record: RegisterPauseChange): RegisterPauseChangeDecisionPreview {
  if (
    typeof record.intentDigest !== 'string' ||
    typeof record.paused !== 'boolean' ||
    typeof record.reason !== 'string' ||
    typeof record.authorityReference !== 'string'
  )
    throw new Error('Invalid fixture terms');
  return {
    previewDigest: DIGEST,
    canDecide: true,
    unmetRequirements: [],
    snapshot: record.snapshot,
    intentDigest: record.intentDigest,
    approvalDecision: record.approvalDecision,
    paused: record.paused,
    reason: record.reason,
    authorityReference: record.authorityReference,
  };
}
function applied() {
  const record = prepared();
  record.status = 'applied';
  record.stage = 'applied';
  record.approvalDecision = ID(124);
  record.execution = {
    submissionId: record.uuid,
    paused: true,
    status: 'pending',
    completedAt: null,
    operationId: null,
    claimId: null,
    operationStatus: null,
    txHash: null,
    blockNumber: null,
    blockHash: null,
    gasUsed: null,
    observation: null,
  };
  return record;
}
function decided(kind: RegisterDecideRequest['kind']) {
  const record = kind === 'apply' ? applied() : prepared();
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
  return record;
}
it('binds the full original preparation on whole-share while permitting either explicit direction', () => {
  const record = prepared();
  expect(isPreparedRegisterPauseChange(record, body, COMPANY)).toBe(true);
  expect(record.snapshot.token.decimals).toBe(0);
  expect(isPreparedRegisterPauseChange({ ...record, paused: false }, { ...body, paused: false }, COMPANY)).toBe(true);
});
it.each([
  [
    'operation',
    (row: RegisterPauseChange) => {
      row.operationId = ID(999);
    },
  ],
  [
    'company',
    (row: RegisterPauseChange) => {
      row.company = ID(999);
    },
  ],
  [
    'direction',
    (row: RegisterPauseChange) => {
      row.paused = false;
    },
  ],
  [
    'reason',
    (row: RegisterPauseChange) => {
      row.reason = 'Changed reason';
    },
  ],
  [
    'reference',
    (row: RegisterPauseChange) => {
      row.authorityReference = 'Changed reference';
    },
  ],
  [
    'evidence',
    (row: RegisterPauseChange) => {
      row.authorityEvidence = ID(999);
    },
  ],
  [
    'intent',
    (row: RegisterPauseChange) => {
      row.intentDigest = 'malformed';
    },
  ],
  [
    'journal attribution',
    (row: RegisterPauseChange) => {
      row.status = 'applied';
      row.approvalDecision = ID(124);
      row.execution = { ...applied().execution!, submissionId: ID(999) };
    },
  ],
] as const)('refuses a preparation receipt with another original %s', (_name, change) => {
  const record = prepared();
  change(record);
  expect(isPreparedRegisterPauseChange(record, body, COMPANY)).toBe(false);
});
it.each(['approve', 'apply', 'reject'] as const)(
  'binds an actual %s receipt to its preview and original consumed decision',
  (kind) => {
    const record = decided(kind);
    const command = { ...request, kind, reason: kind === 'reject' ? 'Company refusal' : '' };
    const shown = preview(record);
    expect(isRegisterPauseChangeDecisionReceipt(record, record.uuid, command, shown)).toBe(true);
    expect(isRegisterPauseChangeDecisionReceipt(record, record.uuid, command, { ...shown, paused: false })).toBe(false);
    expect(
      isRegisterPauseChangeDecisionReceipt(record, record.uuid, command, { ...shown, authorityReference: 'changed' }),
    ).toBe(false);
    expect(
      isRegisterPauseChangeDecisionReceipt(record, record.uuid, { ...command, idempotencyKey: ID(999) }, shown),
    ).toBe(false);
    if (kind === 'apply')
      expect(
        isRegisterPauseChangeDecisionReceipt(record, record.uuid, command, { ...shown, approvalDecision: ID(999) }),
      ).toBe(false);
  },
);
it('retains the original approval receipt after a later applied stage without inventing a second approval', () => {
  const record = decided('approve'),
    shown = preview(record);
  record.status = 'applied';
  record.stage = 'applied';
  record.approvalDecision = record.decisions[0]!.uuid;
  record.execution = applied().execution;
  expect(isRegisterPauseChangeDecisionReceipt(record, record.uuid, request, shown)).toBe(true);
});
it('claims a no-transaction outcome only for the exact completed original typed observation with no outgoing fields', () => {
  const record = applied();
  record.execution = {
    ...record.execution!,
    status: 'observed',
    completedAt: '2026-10-08T00:02:00Z',
    observation: { blockNumber: 7, blockHash: `0x${'4'.repeat(64)}`, observedAt: '2026-10-08T00:01:00Z' },
  };
  expect(registerPauseChangeExecutionState(record)).toBe(
    'Requested state already observed; no transaction, signature or nonce',
  );
  for (const change of [
    { operationId: ID(170) },
    { txHash: `0x${'3'.repeat(64)}` },
    { completedAt: null },
    { observation: null },
    { observation: { ...record.execution.observation!, blockHash: 'wrong' } },
  ])
    expect(registerPauseChangeExecutionState({ ...record, execution: { ...record.execution, ...change } })).toBe(
      'Original marked observed; complete original no-transaction observation unavailable',
    );
});
it('requires exact original transaction, block and projected completion for confirmed success', () => {
  const record = applied();
  record.execution = {
    ...record.execution!,
    status: 'confirmed',
    completedAt: '2026-10-08T00:02:00Z',
    operationId: ID(170),
    claimId: ID(171),
    operationStatus: 'confirmed',
    txHash: `0x${'3'.repeat(64)}`,
    blockNumber: 7,
    blockHash: `0x${'4'.repeat(64)}`,
    gasUsed: 24000,
  };
  expect(registerPauseChangeExecutionState(record)).toBe('Finalised original pause transaction projected');
  for (const change of [
    { completedAt: null },
    { txHash: null },
    { blockHash: null },
    { operationId: null },
    { claimId: null },
  ])
    expect(registerPauseChangeExecutionState({ ...record, execution: { ...record.execution, ...change } })).toBe(
      'Original marked confirmed; complete original chain receipt unavailable',
    );
});
it.each([
  [null, 'No pause execution admitted'],
  [{ ...applied().execution!, operationStatus: 'signed' }, 'Original transaction signed; confirmation pending'],
  [
    { ...applied().execution!, operationStatus: 'confirmed' },
    'Original chain receipt confirmed; finality and projection pending',
  ],
  [
    { ...applied().execution!, status: 'failed', completedAt: '2026-10-08T00:02:00Z' },
    'Original pause execution failed',
  ],
  [{ ...applied().execution!, operationStatus: 'reverted' }, 'Original transaction reverted'],
  [{ ...applied().execution!, submissionId: ID(999) }, 'Original pause receipt does not identify this instruction'],
] as const)('keeps queued, signed, failed and incomplete original receipts distinct (%s)', (execution, label) => {
  expect(registerPauseChangeExecutionState({ ...prepared(), execution })).toBe(label);
});

it.each(
  (['observed completion', 'observation time', 'confirmed completion'] as const).flatMap((field) =>
    [
      ['date array', ['2026-10-08T00:02:00Z']],
      ['number', 1],
    ].map(([valueName, value]) => [field, valueName, value] as const),
  ),
)('refuses a completed original %s label for a coercible %s timestamp', (field, _valueName, value) => {
  const record = applied();
  const completedAt = '2026-10-08T00:02:00Z';
  record.execution =
    field === 'confirmed completion'
      ? {
          ...record.execution!,
          status: 'confirmed',
          completedAt,
          operationId: ID(170),
          claimId: ID(171),
          operationStatus: 'confirmed',
          txHash: `0x${'3'.repeat(64)}`,
          blockNumber: 7,
          blockHash: `0x${'4'.repeat(64)}`,
          gasUsed: 24000,
        }
      : {
          ...record.execution!,
          status: 'observed',
          completedAt,
          observation: { blockNumber: 7, blockHash: `0x${'4'.repeat(64)}`, observedAt: completedAt },
        };
  if (field === 'observation time') record.execution.observation!.observedAt = value as unknown as string;
  else record.execution.completedAt = value as unknown as string;
  expect(registerPauseChangeExecutionState(record)).toBe(
    field === 'confirmed completion'
      ? 'Original marked confirmed; complete original chain receipt unavailable'
      : 'Original marked observed; complete original no-transaction observation unavailable',
  );
});
