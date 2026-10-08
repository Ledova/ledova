import axios from 'axios';
import type { RegisterIssue, RegisterIssuePreparation, RegisterIssueDecisionPreview } from '../../src/types';
import {
  getRegisterIssues,
  getRegisterIssue,
  prepareRegisterIssue,
  previewRegisterIssueDecision,
  decideRegisterIssue,
  downloadRegisterIssueFile,
} from '../../src/services/register-issues';
import {
  isPreparedRegisterIssue,
  isRegisterIssueDecisionReceipt,
  registerIssueExecutionState,
} from '../../src/utils/register-issues';

const DIGEST = 'd'.repeat(64);
const ADDRESS = '0x' + '1'.repeat(40);
const BODY: RegisterIssuePreparation = {
  operationId: 'proposal',
  appointment: 'appointment',
  token: 'token',
  member: 'member',
  nomination: 'nomination',
  walletApproval: 'add-change',
  shares: '25',
  approvingDirector: 'Synthetic Director',
  authorityReference: 'RES-1',
  reason: 'Employee grant',
  termsOn: '2020-01-01',
  terms: 'Outright non-paid grant',
  acceptanceRequired: true,
  authorityEvidence: 'authority',
  termsEvidence: 'terms',
  acceptanceEvidence: 'acceptance',
};
function prepared(): RegisterIssue {
  return {
    ...BODY,
    uuid: BODY.operationId,
    operationId: BODY.operationId,
    company: 'company',
    request: 'request',
    preparingAppointment: BODY.appointment,
    evidenceFingerprint: 'a'.repeat(64),
    evidenceSnapshot: {},
    termsFingerprint: 'b'.repeat(64),
    termsSnapshot: {},
    acceptanceFingerprint: 'c'.repeat(64),
    acceptanceSnapshot: {},
    acceptanceEvidence: 'acceptance',
    providedBy: 'company',
    preparedByName: 'Synthetic Preparer',
    submittedBy: 1,
    status: 'submitted',
    stage: 'submitted',
    approvalDecision: null,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: '',
    decisions: [],
    createdAt: '2026-10-08T00:00:00Z',
    intentDigest: DIGEST,
    execution: null,
    executionUnmetRequirements: [],
    snapshot: {
      company: { uuid: 'company', name: 'Synthetic Company', acn: '123456789', status: 'active' },
      token: {
        uuid: 'token',
        name: 'Ordinary shares',
        symbol: 'ORD',
        chain: 'base',
        contractAddress: '0x' + '2'.repeat(40),
        authorisedShares: '9007199254740993',
      },
      member: {
        uuid: 'member',
        name: 'Synthetic Member',
        residentialAddress: '1 Synthetic Street',
        identitySource: 'documented_member',
        address: ADDRESS,
      },
      wallet: {
        nomination: 'nomination',
        approval: 'add-change',
        address: ADDRESS,
        registryAddress: '0x' + '3'.repeat(40),
        chainId: 84532,
        expiresAt: '2098-01-01T00:00:00Z',
        proofCompletedAt: '2026-10-01T00:00:00Z',
        eligibilityExpiresAt: '2099-01-01T00:00:00Z',
      },
      register: {
        uuid: 'book',
        opening: 'opening',
        sequence: 1,
        headHash: DIGEST,
        issuedSupply: '9007199254740980',
        currentShares: '0',
      },
      transaction: {
        chainId: 84532,
        sender: '0x' + '4'.repeat(40),
        to: '0x' + '2'.repeat(40),
        value: '0',
        data: '0x1234',
      },
    },
  };
}
function preview(record: RegisterIssue): RegisterIssueDecisionPreview {
  if (
    typeof record.intentDigest !== 'string' ||
    typeof record.shares !== 'string' ||
    typeof record.termsOn !== 'string' ||
    typeof record.terms !== 'string' ||
    typeof record.acceptanceRequired !== 'boolean'
  )
    throw new Error('Synthetic company grant fixture is incomplete.');
  return {
    previewDigest: DIGEST,
    canDecide: true,
    unmetRequirements: [],
    snapshot: record.snapshot,
    intentDigest: record.intentDigest,
    approvalDecision: 'approval',
    shares: record.shares,
    termsOn: record.termsOn,
    terms: record.terms,
    acceptanceRequired: record.acceptanceRequired,
    approvingDirector: record.approvingDirector,
    authorityReference: record.authorityReference,
    reason: record.reason,
    registerSequence: 1,
    issuedSupply: '9007199254740980',
    reservedShares: '0',
    authorisedSupply: '9007199254740993',
    availableShares: '13',
    afterIssuedSupply: '9007199254741005',
    currentShares: '0',
    afterShares: '25',
  };
}
afterEach(() => jest.restoreAllMocks());

it('binds the retained preparation to its exact body, company, nominated address and genuine source', () => {
  const record = prepared();
  expect(isPreparedRegisterIssue(record, BODY, 'company', ADDRESS)).toBe(true);
  for (const changed of [
    { operationId: 'other' },
    { token: 'other' },
    { member: 'other' },
    { nomination: 'other' },
    { walletApproval: 'other' },
    { approvingDirector: 'other' },
    { authorityEvidence: 'other' },
    { termsEvidence: 'other' },
    { acceptanceEvidence: null },
    { shares: '2147483648' },
    { termsOn: '2026-10-08' },
    { terms: 'Changed' },
    { acceptanceRequired: false },
  ])
    expect(isPreparedRegisterIssue({ ...record, ...changed }, BODY, 'company', ADDRESS)).toBe(false);
  expect(isPreparedRegisterIssue(record, BODY, 'other', ADDRESS)).toBe(false);
  expect(isPreparedRegisterIssue(record, BODY, 'company', '0x' + '5'.repeat(40))).toBe(false);
  expect(isPreparedRegisterIssue({ ...record, status: 'applied' }, BODY, 'company', ADDRESS)).toBe(false);
  expect(
    isPreparedRegisterIssue(
      { ...record, snapshot: { ...record.snapshot, wallet: { ...record.snapshot.wallet, approval: 'other' } } },
      BODY,
      'company',
      ADDRESS,
    ),
  ).toBe(false);
});

it('requires consumed approval and original execution for application and accepts historical exact approval recovery', () => {
  const request = {
    appointment: 'appointment',
    kind: 'apply' as const,
    idempotencyKey: 'key',
    previewDigest: DIGEST,
    reason: '',
    confirmation: true,
  };
  const decision = {
    uuid: 'decision',
    appointment: request.appointment,
    kind: request.kind,
    idempotencyKey: request.idempotencyKey,
    digest: request.previewDigest,
    reason: '',
    decidedBy: 1,
    decidedByName: 'Synthetic Applier',
    decidedAt: '2026-10-08T00:00:00Z',
  };
  const record: RegisterIssue = {
    ...prepared(),
    status: 'applied',
    stage: 'applied',
    approvalDecision: 'approval',
    reviewedAt: decision.decidedAt,
    decisions: [decision],
    execution: {
      execution: 'execution',
      status: 'queued',
      request: 'request',
      dispatchId: 'dispatch',
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
    },
  };
  expect(isRegisterIssueDecisionReceipt(record, record.uuid, request, preview(record))).toBe(true);
  for (const changed of [
    { approvalDecision: null },
    { approvalDecision: 'different' },
    { execution: null },
    { reviewedAt: null },
  ])
    expect(isRegisterIssueDecisionReceipt({ ...record, ...changed }, record.uuid, request, preview(record))).toBe(
      false,
    );
  expect(
    isRegisterIssueDecisionReceipt(record, record.uuid, { ...request, idempotencyKey: 'other' }, preview(record)),
  ).toBe(false);
  expect(isRegisterIssueDecisionReceipt(record, record.uuid, request, { ...preview(record), terms: 'Changed' })).toBe(
    false,
  );
  expect(
    isRegisterIssueDecisionReceipt(
      { ...record, decisions: [{ ...decision, kind: 'approve' }] },
      record.uuid,
      { ...request, kind: 'approve' },
      preview(record),
    ),
  ).toBe(true);
});

it('keeps admission, unsigned hold, signed receipt, finality and actual ledger projection distinct', () => {
  const record = prepared();
  expect(registerIssueExecutionState(record)).toBe('No issue execution admitted');
  const queued = {
    execution: 'execution',
    status: 'queued',
    request: 'request',
    dispatchId: 'dispatch',
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
  expect(registerIssueExecutionState({ ...record, execution: queued })).toBe(
    'Original issue admitted; execution queued',
  );
  expect(
    registerIssueExecutionState({ ...record, execution: queued, executionUnmetRequirements: ['approval_lapsed'] }),
  ).toBe('Original unsigned execution held');
  expect(
    registerIssueExecutionState({
      ...record,
      execution: { ...queued, operationStatus: 'signed' },
      executionUnmetRequirements: ['approval_lapsed'],
    }),
  ).toBe('Original transaction signed; confirmation pending');
  expect(registerIssueExecutionState({ ...record, execution: { ...queued, operationStatus: 'confirmed' } })).toBe(
    'Chain receipt confirmed; finality and projection pending',
  );
  const finalised = {
    ...queued,
    status: 'executed',
    operationStatus: 'confirmed',
    issuance: 'issuance',
    txHash: '0xreceipt',
    blockNumber: 3,
    blockHash: '0xblock',
    completedAt: '2026-10-08T00:00:00Z',
  };
  expect(registerIssueExecutionState({ ...record, execution: finalised })).toBe(
    'Finalised mint; register entry not recorded',
  );
  expect(
    registerIssueExecutionState({
      ...record,
      execution: { ...finalised, registerEntry: 'entry', effectiveOn: '2026-10-08' },
    }),
  ).toBe('Finalised mint recorded in the register');
  expect(
    registerIssueExecutionState({
      ...record,
      execution: { ...finalised, registerEntry: 'entry', effectiveOn: '2026-10-08', operationStatus: 'reverted' },
    }),
  ).toBe('Original transaction reverted');
});

it('uses the actual eight family/file operations with the original body and transport/session guards', async () => {
  const api = axios.create();
  const get = jest.spyOn(api, 'get').mockResolvedValue({ data: {} });
  const post = jest.spyOn(api, 'post').mockResolvedValue({ data: {} });
  const config = { ledovaSessionEpoch: 7, ledovaSubmissionGuard: () => undefined };
  const preview = { appointment: 'appointment', kind: 'apply' as const };
  const decide = { ...preview, idempotencyKey: 'key', previewDigest: DIGEST, confirmation: true };
  await getRegisterIssues(api, { company: 'company', token: 'token' }, config);
  await getRegisterIssue(api, 'proposal', config);
  await prepareRegisterIssue(api, BODY, config);
  await previewRegisterIssueDecision(api, 'proposal', preview, config);
  await decideRegisterIssue(api, 'proposal', decide, config);
  for (const kind of ['authority', 'terms', 'acceptance'] as const)
    await downloadRegisterIssueFile(api, 'proposal', kind, config);
  expect(get.mock.calls).toEqual([
    ['/api/v1/tokens/register-issues/', { ...config, params: { company: 'company', token: 'token' } }],
    ['/api/v1/tokens/register-issues/proposal/', config],
    ['/api/v1/tokens/register-issues/proposal/file/', { ...config, responseType: 'blob' }],
    ['/api/v1/tokens/register-issues/proposal/terms-file/', { ...config, responseType: 'blob' }],
    ['/api/v1/tokens/register-issues/proposal/acceptance-file/', { ...config, responseType: 'blob' }],
  ]);
  expect(post.mock.calls).toEqual([
    ['/api/v1/tokens/register-issues/', BODY, config],
    ['/api/v1/tokens/register-issues/proposal/decision-preview/', preview, config],
    ['/api/v1/tokens/register-issues/proposal/decide/', decide, config],
  ]);
});
