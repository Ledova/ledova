import axios from 'axios';
import type {
  RegisterDeployment,
  RegisterDeploymentPreparation,
  RegisterDeploymentDecideRequest,
} from '../../src/types';
import {
  getRegisterDeployments,
  prepareRegisterDeployment,
  retrieveRegisterDeployment,
  previewRegisterDeploymentDecision,
  decideRegisterDeployment,
} from '../../src/services/register-deployments';
import {
  isPreparedRegisterDeployment,
  isRegisterDeploymentDecisionReceipt,
} from '../../src/utils/register-deployments';
import { registerDeploymentExecutionState } from '../../src/constants/business/register-deployments';
const uuid = 'ordinary';
const DIGEST = 'd'.repeat(64);
const REQUEST: RegisterDeploymentPreparation = { operationId: 'proposal', appointment: 'appointment', token: uuid };
function prepared(body: RegisterDeploymentPreparation): RegisterDeployment {
  return {
    uuid: body.operationId,
    operationId: body.operationId,
    company: 'company',
    token: body.token,
    preparingAppointment: body.appointment,
    preparedByName: 'Synthetic Preparer',
    providedBy: 'company',
    submittedBy: 1,
    status: 'submitted',
    stage: 'submitted',
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: '',
    createdAt: '2026-10-07T00:00:00Z',
    decisions: [],
    intentDigest: DIGEST,
    deploymentId: null,
    approvalDecision: null,
    execution: null,
    executionUnmetRequirements: [],
    snapshot: {
      company: { uuid: 'company', name: 'Paper Company', acn: '123456789', status: 'active' },
      token: {
        uuid,
        name: 'Ordinary shares',
        symbol: 'ORD',
        identifier: 'ORD-1',
        authorisedShares: '1000',
        decimals: 0,
      },
      issuerWallet: { address: `0x${'1'.repeat(40)}`, chain: 'base' },
      register: { present: false, initialized: null, uuid: null, sequence: null, headHash: null, issuedSupply: null },
      transaction: {
        chainId: 84532,
        sender: `0x${'2'.repeat(40)}`,
        to: `0x${'3'.repeat(40)}`,
        value: '0',
        data: '0x1234',
      },
    },
  };
}
afterEach(() => jest.restoreAllMocks());
it('binds preparation to the original UUID, scope, immutable snapshot and real admission IDs', () => {
  const record = prepared(REQUEST);
  expect(isPreparedRegisterDeployment(record, REQUEST, 'company')).toBe(true);
  for (const changed of [
    { operationId: 'other' },
    { company: 'other' },
    { token: 'other' },
    { preparingAppointment: 'other' },
    { status: 'applied' as const },
  ])
    expect(isPreparedRegisterDeployment({ ...record, ...changed }, REQUEST, 'company')).toBe(false);
  const unopened = {
    ...record,
    snapshot: {
      ...record.snapshot,
      register: { present: true, initialized: false, uuid: 'book', sequence: 0, headHash: '', issuedSupply: null },
    },
  };
  expect(isPreparedRegisterDeployment(unopened, REQUEST, 'company')).toBe(true);
  expect(
    isPreparedRegisterDeployment(
      {
        ...unopened,
        snapshot: { ...unopened.snapshot, register: { ...unopened.snapshot.register, initialized: true } },
      },
      REQUEST,
      'company',
    ),
  ).toBe(false);
});
it('requires exact decision, consumed approval and original deployment before claiming admission, and retains historical approvals', () => {
  const request: RegisterDeploymentDecideRequest = {
    appointment: 'appointment',
    kind: 'apply',
    idempotencyKey: 'key',
    previewDigest: DIGEST,
    confirmation: true,
    reason: '',
  };
  const decision = {
    uuid: 'decision',
    kind: request.kind,
    appointment: request.appointment,
    idempotencyKey: request.idempotencyKey,
    digest: DIGEST,
    reason: '',
    decidedBy: 1,
    decidedByName: 'Synthetic Applier',
    decidedAt: '2026-10-07T01:00:00Z',
  };
  const record: RegisterDeployment = {
    ...prepared(REQUEST),
    status: 'applied',
    stage: 'applied',
    reviewedAt: decision.decidedAt,
    decisions: [decision],
    deploymentId: 'deployment',
    approvalDecision: 'approval',
  };
  const preview = {
    snapshot: record.snapshot,
    intentDigest: DIGEST,
    previewDigest: DIGEST,
    canDecide: true,
    unmetRequirements: [],
    deploymentId: null,
    approvalDecision: 'approval',
  };
  expect(isRegisterDeploymentDecisionReceipt(record, 'proposal', request, preview)).toBe(true);
  for (const changed of [
    { deploymentId: null },
    { approvalDecision: null },
    { approvalDecision: 'different' },
    {
      execution: {
        deployment: 'other',
        operationId: null,
        claimId: null,
        operationStatus: null,
        txHash: null,
        contractAddress: null,
        attributionRequired: false,
        projectedAt: null,
        swapApprovalOutcome: null,
      },
    },
  ])
    expect(isRegisterDeploymentDecisionReceipt({ ...record, ...changed }, 'proposal', request, preview)).toBe(false);
  expect(
    isRegisterDeploymentDecisionReceipt(
      { ...record, decisions: [{ ...decision, kind: 'approve' }] },
      'proposal',
      { ...request, kind: 'approve' },
      preview,
    ),
  ).toBe(true);
});
it('uses only the five schema routes and propagates the session guard for original receipt recovery', async () => {
  const api = axios.create();
  const get = jest.spyOn(api, 'get').mockResolvedValue({ data: {} });
  const post = jest.spyOn(api, 'post').mockResolvedValue({ data: {} });
  const config = { ledovaSessionEpoch: 3, ledovaSubmissionGuard: () => undefined };
  const preview = { appointment: 'appointment', kind: 'apply' as const };
  const decide = { ...preview, idempotencyKey: 'key', previewDigest: DIGEST, confirmation: true };
  await getRegisterDeployments(api, { token: uuid }, config);
  await retrieveRegisterDeployment(api, 'proposal', config);
  await prepareRegisterDeployment(api, REQUEST, config);
  await previewRegisterDeploymentDecision(api, 'proposal', preview, config);
  await decideRegisterDeployment(api, 'proposal', decide, config);
  expect(get.mock.calls).toEqual([
    ['/api/v1/tokens/register-deployments/', { ...config, params: { token: uuid } }],
    ['/api/v1/tokens/register-deployments/proposal/', config],
  ]);
  expect(post.mock.calls).toEqual([
    ['/api/v1/tokens/register-deployments/', REQUEST, config],
    ['/api/v1/tokens/register-deployments/proposal/decision-preview/', preview, config],
    ['/api/v1/tokens/register-deployments/proposal/decide/', decide, config],
  ]);
});

it('keeps a reverted or failed original distinct from an earlier projection, with confirmed completion as the control', () => {
  const record: RegisterDeployment = {
    ...prepared(REQUEST),
    status: 'applied',
    stage: 'applied',
    deploymentId: 'deployment',
    approvalDecision: 'approval',
    execution: {
      deployment: 'deployment',
      operationId: 'outgoing',
      claimId: 'claim',
      operationStatus: 'confirmed',
      txHash: '0xreceipt',
      contractAddress: '0xcontract',
      attributionRequired: false,
      projectedAt: '2026-10-07T01:00:00Z',
      swapApprovalOutcome: null,
    },
  };
  expect(registerDeploymentExecutionState(record)).toBe('Confirmed and projected');
  expect(
    registerDeploymentExecutionState({ ...record, execution: { ...record.execution!, operationStatus: 'reverted' } }),
  ).toBe('Transaction reverted');
  expect(
    registerDeploymentExecutionState({ ...record, execution: { ...record.execution!, operationStatus: 'failed' } }),
  ).toBe('Failed before signing');
});
