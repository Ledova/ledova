import axios from 'axios';
import {
  getWalletNominations,
  getWalletNomination,
  previewWalletNomination,
  createWalletNomination,
  getCompanyWalletNominations,
  getCompanyWalletNomination,
  getCompanyWalletInstructions,
  getCompanyWalletInstruction,
  prepareCompanyWalletInstruction,
  previewCompanyWalletDecision,
  decideCompanyWalletInstruction,
  getCompanyWalletTargets,
  getCompanyWalletTarget,
} from '../../src/services/company-wallets';
import {
  isWalletNominationReceipt,
  isPreparedCompanyWalletInstruction,
  isCompanyWalletDecisionReceipt,
} from '../../src/utils/company-wallets';
import { companyWalletExecutionState } from '../../src/constants/business/company-wallets';
import type {
  CompanyWalletInstruction,
  CompanyWalletPreparation,
  CompanyWalletDecisionPreview,
  CompanyWalletDecideRequest,
  WalletNomination,
  WalletNominationPreview,
  WalletNominationRequest,
} from '../../src/types';
const digest = 'a'.repeat(64),
  timestamp = '2026-10-07T00:00:00Z',
  expiry = '2027-01-05T12:00:00Z';
const request: CompanyWalletPreparation = {
  operationId: 'original',
  appointment: 'appointment',
  company: 'company',
  action: 'add',
  nomination: 'nomination',
  expiresAt: '2027-01-05T12:00:00.000Z',
};
function instruction(): CompanyWalletInstruction {
  return {
    uuid: 'original',
    operationId: 'original',
    company: 'company',
    action: 'add',
    nomination: 'nomination',
    targetChange: null,
    expiresAt: expiry,
    preparingAppointment: 'appointment',
    preparedByName: 'Synthetic Administrator',
    providedBy: 'company',
    submittedBy: 1,
    status: 'submitted',
    stage: 'submitted',
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: '',
    createdAt: timestamp,
    decisions: [],
    approvalDecision: null,
    changeId: null,
    intentDigest: digest,
    execution: null,
    executionUnmetRequirements: [],
    snapshot: {
      company: { uuid: 'company', name: 'Company A', acn: '123456789', status: 'active' },
      target: {
        address: '0x' + 'a'.repeat(40),
        chain: 'base',
        chainId: 84532,
        registryAddress: '0x' + 'b'.repeat(40),
        expiresAt: expiry,
      },
      source: {
        nomination: 'nomination',
        request: 'request',
        decision: 'general',
        proofCompletedAt: timestamp,
        eligibilityExpiresAt: expiry,
        targetChange: null,
      },
      transaction: {
        chainId: 84532,
        sender: '0x' + 'c'.repeat(40),
        to: '0x' + 'b'.repeat(40),
        value: '0',
        data: '0x1234',
      },
    },
  };
}
afterEach(() => jest.restoreAllMocks());
it('uses the thirteen bounded schema routes with guards for original receipt recovery', async () => {
  const api = axios.create(),
    get = jest.spyOn(api, 'get').mockResolvedValue({ data: {} }),
    post = jest.spyOn(api, 'post').mockResolvedValue({ data: {} });
  const config = { ledovaSessionEpoch: 3, ledovaSubmissionGuard: () => undefined },
    own = '/api/v1/whitelist/wallet-nominations/',
    nominations = '/api/v1/whitelist/company-wallet-nominations/',
    instructions = '/api/v1/whitelist/company-wallet-instructions/',
    targets = '/api/v1/whitelist/company-wallet-targets/';
  const ownPreview = { request: 'request', wallet: 'wallet' },
    nomination = { ...ownPreview, operationId: 'nomination', previewDigest: digest, sharingAccepted: true };
  const preview = { appointment: 'appointment', kind: 'apply' as const },
    decide = { ...preview, idempotencyKey: 'key', previewDigest: digest, confirmation: true };
  await getWalletNominations(api, { request: 'request' }, config);
  await getWalletNomination(api, 'nomination', config);
  await previewWalletNomination(api, ownPreview, config);
  await createWalletNomination(api, nomination, config);
  await getCompanyWalletNominations(api, { company: 'company' }, config);
  await getCompanyWalletNomination(api, 'nomination', config);
  await getCompanyWalletInstructions(api, { company: 'company' }, config);
  await getCompanyWalletInstruction(api, 'original', config);
  await prepareCompanyWalletInstruction(api, request, config);
  await previewCompanyWalletDecision(api, 'original', preview, config);
  await decideCompanyWalletInstruction(api, 'original', decide, config);
  await getCompanyWalletTargets(api, { company: 'company' }, config);
  await getCompanyWalletTarget(api, 'change', config);
  expect(get.mock.calls).toEqual([
    [own, { ...config, params: { request: 'request' } }],
    [`${own}nomination/`, config],
    [nominations, { ...config, params: { company: 'company' } }],
    [`${nominations}nomination/`, config],
    [instructions, { ...config, params: { company: 'company' } }],
    [`${instructions}original/`, config],
    [targets, { ...config, params: { company: 'company' } }],
    [`${targets}change/`, config],
  ]);
  expect(post.mock.calls).toEqual([
    [`${own}preview/`, ownPreview, config],
    [own, nomination, config],
    [instructions, request, config],
    [`${instructions}original/decision-preview/`, preview, config],
    [`${instructions}original/decide/`, decide, config],
  ]);
});
it('binds explicit address sharing to the selected company request, proof and original operation', () => {
  const preview: WalletNominationPreview = {
    request: 'request',
    wallet: 'wallet',
    company: 'company',
    decision: 'general',
    proof: 'proof',
    address: '0x' + 'a'.repeat(40),
    chain: 'base',
    proofCompletedAt: timestamp,
    eligibilityExpiresAt: expiry,
    previewDigest: digest,
    canSubmit: true,
    unmetRequirements: [],
  };
  const body: WalletNominationRequest = {
    request: 'request',
    wallet: 'wallet',
    operationId: 'nomination',
    previewDigest: digest,
    sharingAccepted: true,
  };
  const record: WalletNomination = {
    uuid: 'nomination',
    operationId: 'nomination',
    request: 'request',
    wallet: 'wallet',
    company: 'company',
    decision: 'general',
    proof: 'proof',
    address: preview.address,
    chain: 'base',
    proofCompletedAt: timestamp,
    eligibilityExpiresAt: expiry,
    digest,
    sharingAccepted: true,
    submittedAt: timestamp,
    unmetRequirements: [],
  };
  expect(isWalletNominationReceipt(record, body, preview)).toBe(true);
  for (const changed of [
    { company: 'other' },
    { wallet: 'other' },
    { decision: 'other' },
    { proof: 'other' },
    { address: '0xother' },
    { sharingAccepted: false },
    { operationId: 'new' },
  ])
    expect(isWalletNominationReceipt({ ...record, ...changed }, body, preview)).toBe(false);
  expect(
    isWalletNominationReceipt({ ...record, unmetRequirements: ['eligibility_source_lapsed'] }, body, preview),
  ).toBe(true);
});
it('requires original company/target bindings and genuine consumed approval while preserving historical approvals', () => {
  const record = instruction();
  expect(isPreparedCompanyWalletInstruction(record, request)).toBe(true);
  for (const changed of [
    { operationId: 'new' },
    { company: 'other' },
    { nomination: 'other' },
    { preparingAppointment: 'other' },
    { expiresAt: '2028-01-05T12:00:00Z' },
    { status: 'applied' as const },
  ])
    expect(isPreparedCompanyWalletInstruction({ ...record, ...changed }, request)).toBe(false);
  const body: CompanyWalletDecideRequest = {
    appointment: 'appointment',
    kind: 'apply',
    reason: '',
    idempotencyKey: 'key',
    previewDigest: digest,
    confirmation: true,
  };
  const decision = {
    uuid: 'apply',
    kind: body.kind,
    appointment: body.appointment,
    reason: '',
    idempotencyKey: body.idempotencyKey,
    digest,
    decidedAt: timestamp,
    decidedBy: 1,
    decidedByName: 'Synthetic Administrator',
  };
  const admitted: CompanyWalletInstruction = {
    ...record,
    status: 'applied',
    stage: 'applied',
    changeId: 'change',
    approvalDecision: 'approval',
    reviewedAt: timestamp,
    decisions: [decision],
  };
  const preview: CompanyWalletDecisionPreview = {
    snapshot: record.snapshot,
    intentDigest: digest,
    previewDigest: digest,
    canDecide: true,
    unmetRequirements: [],
    approvalDecision: 'approval',
    changeId: null,
  };
  expect(isCompanyWalletDecisionReceipt(admitted, 'original', body, preview)).toBe(true);
  for (const changed of [
    { operationId: 'new' },
    { company: 'other' },
    { nomination: 'other' },
    { targetChange: 'other' },
    { expiresAt: '2028-01-05T12:00:00Z' },
    { changeId: null },
    { approvalDecision: null },
    { approvalDecision: 'other' },
    { reviewedAt: null },
    { company: 'other', snapshot: { ...record.snapshot, company: { ...record.snapshot.company, uuid: 'other' } } },
  ])
    expect(isCompanyWalletDecisionReceipt({ ...admitted, ...changed }, 'original', body, preview)).toBe(false);
  expect(
    isCompanyWalletDecisionReceipt(
      { ...admitted, decisions: [{ ...decision, kind: 'approve' }] },
      'original',
      { ...body, kind: 'approve' },
      preview,
    ),
  ).toBe(true);
  const rejected: CompanyWalletInstruction = {
    ...record,
    status: 'rejected',
    stage: 'rejected',
    reviewedAt: timestamp,
    rejectionReason: 'Synthetic company refusal',
    decisions: [{ ...decision, kind: 'reject', reason: 'Synthetic company refusal' }],
  };
  const rejection = { ...body, kind: 'reject' as const, reason: 'Synthetic company refusal' };
  expect(isCompanyWalletDecisionReceipt(rejected, 'original', rejection, preview)).toBe(true);
  expect(
    isCompanyWalletDecisionReceipt({ ...rejected, rejectionReason: 'Other reason' }, 'original', rejection, preview),
  ).toBe(false);
});
it('distinguishes admission, unsigned hold, signed recovery, chain confirmation, projection and observed unchanged', () => {
  const admitted: CompanyWalletInstruction = {
    ...instruction(),
    status: 'applied',
    stage: 'applied',
    changeId: 'change',
    approvalDecision: 'approval',
  };
  const execution: NonNullable<CompanyWalletInstruction['execution']> = {
    change: 'change',
    status: 'executing',
    operationId: 'outgoing',
    claimId: 'claim',
    operationStatus: 'signed',
    txHash: '0xhash',
    transaction: null,
    blockNumber: null,
    blockHash: null,
    completedAt: null,
    failureCode: '',
  };
  expect(companyWalletExecutionState(admitted)).toBe('Admitted; original execution pending');
  expect(companyWalletExecutionState({ ...admitted, executionUnmetRequirements: ['approval_lapsed'] })).toBe(
    'Unsigned execution held',
  );
  expect(companyWalletExecutionState({ ...admitted, execution, executionUnmetRequirements: ['approval_lapsed'] })).toBe(
    'Original transaction signed; awaiting confirmation',
  );
  expect(companyWalletExecutionState({ ...admitted, execution: { ...execution, operationStatus: 'confirmed' } })).toBe(
    'Original chain outcome confirmed; projection pending',
  );
  expect(
    companyWalletExecutionState({
      ...admitted,
      execution: { ...execution, status: 'confirmed', operationStatus: 'confirmed' },
    }),
  ).toBe('Original chain outcome confirmed and projected');
  expect(
    companyWalletExecutionState({
      ...admitted,
      execution: {
        ...execution,
        status: 'unchanged',
        operationId: null,
        claimId: null,
        operationStatus: null,
        txHash: null,
      },
    }),
  ).toBe('Observed unchanged; no transaction sent');
  expect(companyWalletExecutionState({ ...admitted, execution: { ...execution, operationStatus: 'reverted' } })).toBe(
    'Original transaction reverted',
  );
  expect(
    companyWalletExecutionState({
      ...admitted,
      execution: { ...execution, status: 'failed', operationStatus: 'failed' },
    }),
  ).toBe('Original execution failed');
});
