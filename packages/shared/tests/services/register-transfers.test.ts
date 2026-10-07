import axios from 'axios';
import type { RegisterTransfer, RegisterTransferPreparation } from '../../src/types';
import {
  getRegisterTransferMembers,
  getRegisterTransfers,
  prepareRegisterTransfer,
  previewRegisterTransferDecision,
  decideRegisterTransfer,
  downloadRegisterTransferFile,
} from '../../src/services/register-transfers';
import { isPreparedRegisterTransfer, isRegisterTransferDecisionReceipt } from '../../src/utils/register-transfers';

const REQUEST: RegisterTransferPreparation = {
  operationId: 'transfer-a',
  appointment: 'appointment-a',
  tokenId: 'ordinary',
  fromMember: 'member-a',
  toMember: 'member-b',
  newMember: true,
  name: 'Synthetic Recipient',
  residentialAddress: '2 Synthetic Street',
  shares: '20',
  signedOn: '2026-10-05',
  lodgedOn: '2026-10-06',
  terms: 'Non-paid family gift',
  approvingDirector: 'Independent Director',
  authorityReference: 'Resolution 2',
  reason: 'Family gift',
  authorityEvidence: 'authority-a',
  instrumentEvidence: 'instrument-a',
};
const TRANSFER: RegisterTransfer = {
  uuid: REQUEST.operationId,
  company: 'company-a',
  token: REQUEST.tokenId,
  fromMember: REQUEST.fromMember,
  toMember: REQUEST.toMember,
  newMember: true,
  newParticulars: true,
  fromName: 'Synthetic Transferor',
  fromResidentialAddress: '1 Synthetic Street',
  fromParticulars: {},
  name: REQUEST.name!,
  residentialAddress: REQUEST.residentialAddress!,
  toParticulars: {},
  shares: REQUEST.shares,
  signedOn: REQUEST.signedOn,
  lodgedOn: REQUEST.lodgedOn,
  effectiveOn: null,
  terms: REQUEST.terms,
  authority: 'director_resolution',
  approvingDirector: REQUEST.approvingDirector,
  authorityReference: REQUEST.authorityReference,
  reason: REQUEST.reason,
  authorityEvidence: REQUEST.authorityEvidence,
  evidenceFingerprint: 'a'.repeat(64),
  evidenceSnapshot: {},
  instrumentEvidence: REQUEST.instrumentEvidence,
  instrumentFingerprint: 'b'.repeat(64),
  instrumentSnapshot: {},
  preparingAppointment: REQUEST.appointment,
  preparedByName: 'Synthetic Preparer',
  providedBy: 'company',
  submittedBy: 1,
  status: 'submitted',
  stage: 'submitted',
  registerEntry: null,
  reviewedBy: null,
  reviewedAt: null,
  rejectionReason: '',
  decisions: [],
  createdAt: '2026-10-07T00:00:00Z',
};
afterEach(() => jest.restoreAllMocks());

it('binds both stable parties, refreshed particulars, genuine dates and retained instrument to preparation', () => {
  expect(isPreparedRegisterTransfer(TRANSFER, REQUEST, true)).toBe(true);
  for (const change of [
    { fromMember: 'another' },
    { toMember: 'another' },
    { signedOn: '2026-10-04' },
    { instrumentEvidence: 'another' },
    { newParticulars: false },
    { status: 'applied' as const, registerEntry: null, effectiveOn: null },
    { approvingDirector: 'Synthetic Transferor' },
  ])
    expect(isPreparedRegisterTransfer({ ...TRANSFER, ...change }, REQUEST, true)).toBe(false);
  const existing = { ...REQUEST, newMember: false, name: undefined, residentialAddress: undefined };
  expect(isPreparedRegisterTransfer({ ...TRANSFER, newMember: false, newParticulars: false }, existing, false)).toBe(
    true,
  );
});

it('requires the genuine entry, actual date and exact retained decision before reporting application', () => {
  const request = {
    appointment: 'appointment-a',
    kind: 'apply' as const,
    idempotencyKey: 'key-a',
    previewDigest: 'c'.repeat(64),
    reason: '',
    confirmation: true,
  };
  const decision = {
    uuid: 'decision-a',
    appointment: request.appointment,
    kind: request.kind,
    idempotencyKey: request.idempotencyKey,
    digest: request.previewDigest,
    reason: '',
    decidedBy: 1,
    decidedByName: 'Synthetic Applier',
    decidedAt: '2026-10-07T01:00:00Z',
  };
  const applied = {
    ...TRANSFER,
    status: 'applied' as const,
    stage: 'applied',
    reviewedAt: decision.decidedAt,
    decisions: [decision],
    registerEntry: 'entry-a',
    effectiveOn: '2026-10-07',
  };
  expect(isPreparedRegisterTransfer(applied, REQUEST, true)).toBe(true);
  expect(isRegisterTransferDecisionReceipt(applied, 'transfer-a', request)).toBe(true);
  expect(isRegisterTransferDecisionReceipt({ ...applied, registerEntry: null }, 'transfer-a', request)).toBe(false);
  expect(isRegisterTransferDecisionReceipt({ ...applied, effectiveOn: null }, 'transfer-a', request)).toBe(false);
  expect(isRegisterTransferDecisionReceipt(applied, 'transfer-a', { ...request, appointment: 'another' })).toBe(false);
});

it('binds the selector, preparation, decisions and private files to explicit schema routes and session config', async () => {
  const api = axios.create();
  const get = jest.spyOn(api, 'get').mockResolvedValue({ data: {} });
  const post = jest.spyOn(api, 'post').mockResolvedValue({ data: TRANSFER });
  const session = { timeout: 1000, ledovaSessionEpoch: 3 };
  const preview = { appointment: 'appointment-a', kind: 'apply' as const };
  const decide = { ...preview, idempotencyKey: 'key-a', previewDigest: 'c'.repeat(64), confirmation: true };
  await getRegisterTransferMembers(api, 'ordinary', session);
  await getRegisterTransfers(api, { token: 'ordinary' }, session);
  await prepareRegisterTransfer(api, REQUEST, session);
  await previewRegisterTransferDecision(api, 'transfer-a', preview, session);
  await decideRegisterTransfer(api, 'transfer-a', decide, session);
  await downloadRegisterTransferFile(api, 'transfer-a', 'authority', session);
  await downloadRegisterTransferFile(api, 'transfer-a', 'instrument', session);
  expect(get.mock.calls).toEqual([
    ['/api/v1/tokens/ordinary/register/members/', session],
    ['/api/v1/tokens/register-transfers/', { ...session, params: { token: 'ordinary' } }],
    ['/api/v1/tokens/register-transfers/transfer-a/file/', { ...session, responseType: 'blob' }],
    ['/api/v1/tokens/register-transfers/transfer-a/instrument-file/', { ...session, responseType: 'blob' }],
  ]);
  expect(post.mock.calls).toEqual([
    ['/api/v1/tokens/register-transfers/', REQUEST, session],
    ['/api/v1/tokens/register-transfers/transfer-a/decision-preview/', preview, session],
    ['/api/v1/tokens/register-transfers/transfer-a/decide/', decide, session],
  ]);
});
