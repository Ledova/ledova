import type { RegisterGrant, RegisterGrantPreparation } from '../../src/types';
import { isPreparedRegisterGrant, isRegisterGrantDecisionReceipt } from '../../src/utils/register-grants';

const REQUEST: RegisterGrantPreparation = {
  operationId: 'grant-a',
  appointment: 'appointment-a',
  tokenId: 'ordinary',
  member: 'member-a',
  newMember: true,
  name: 'Synthetic Member',
  residentialAddress: '1 Synthetic Street, Sydney NSW 2000',
  shares: '10',
  termsOn: '2020-01-01',
  approvingDirector: 'Independent Director',
  terms: 'Non-paid employee grant, fully paid without cash consideration',
  authorityReference: 'Resolution 1',
  reason: 'Employee grant',
  authorityEvidence: 'authority-a',
  termsEvidence: 'terms-a',
  acceptanceRequired: true,
  acceptanceEvidence: 'acceptance-a',
};
const GRANT: RegisterGrant = {
  effectiveOn: null,
  uuid: 'grant-a',
  company: 'company-a',
  token: 'ordinary',
  member: 'member-a',
  newMember: true,
  name: 'Synthetic Member',
  residentialAddress: '1 Synthetic Street, Sydney NSW 2000',
  shares: '10',
  termsOn: '2020-01-01',
  approvingDirector: 'Independent Director',
  terms: REQUEST.terms,
  authorityReference: REQUEST.authorityReference,
  reason: REQUEST.reason,
  authorityEvidence: 'authority-a',
  evidenceFingerprint: 'a'.repeat(64),
  evidenceSnapshot: {},
  termsEvidence: 'terms-a',
  termsFingerprint: 'b'.repeat(64),
  termsSnapshot: {},
  acceptanceRequired: true,
  acceptanceEvidence: 'acceptance-a',
  acceptanceFingerprint: 'c'.repeat(64),
  acceptanceSnapshot: {},
  preparingAppointment: 'appointment-a',
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

it('binds preparation to the stable member, terms, authority and required acceptance', () => {
  expect(isPreparedRegisterGrant(GRANT, REQUEST)).toBe(true);
  for (const change of [
    { member: 'different' },
    { terms: 'Paid subscription' },
    { acceptanceEvidence: null },
    { shares: '11' },
    { termsOn: '2019-01-01' },
    { approvingDirector: 'Another Director' },
    { status: 'applied' as const, effectiveOn: null, registerEntry: null },
    { name: 'Another name' },
    { authorityEvidence: 'another-document' },
  ])
    expect(isPreparedRegisterGrant({ ...GRANT, ...change }, REQUEST)).toBe(false);
  const { name: _name, residentialAddress: _address, ...existing } = REQUEST;
  expect(isPreparedRegisterGrant({ ...GRANT, newMember: false }, { ...existing, newMember: false })).toBe(true);
});

it('requires an actual register entry and the exact retained decision before accepting application', () => {
  const request = {
    appointment: 'appointment-a',
    kind: 'apply' as const,
    idempotencyKey: 'key-a',
    previewDigest: 'd'.repeat(64),
    reason: '',
    confirmation: true,
  };
  const decision = {
    uuid: 'decision-a',
    appointment: 'appointment-a',
    kind: 'apply' as const,
    idempotencyKey: 'key-a',
    digest: request.previewDigest,
    reason: '',
    decidedBy: 1,
    decidedByName: 'Synthetic Approver',
    decidedAt: '2026-10-07T01:00:00Z',
  };
  const applied = {
    ...GRANT,
    status: 'applied' as const,
    stage: 'applied',
    reviewedAt: decision.decidedAt,
    decisions: [decision],
    registerEntry: 'entry-a',
    effectiveOn: '2026-10-07',
  };
  expect(isRegisterGrantDecisionReceipt(applied, 'grant-a', request)).toBe(true);
  expect(isPreparedRegisterGrant(applied, REQUEST)).toBe(true);
  expect(isRegisterGrantDecisionReceipt({ ...applied, registerEntry: null }, 'grant-a', request)).toBe(false);
  expect(isRegisterGrantDecisionReceipt({ ...applied, effectiveOn: null }, 'grant-a', request)).toBe(false);
  expect(isRegisterGrantDecisionReceipt(applied, 'grant-a', { ...request, previewDigest: 'e'.repeat(64) })).toBe(false);
});
