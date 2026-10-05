import { REGISTER_CORRECTION_COPY } from '../../src/constants/business/register-corrections';
import type { RegisterCorrection, RegisterCorrectionPreparation, RegisterDecisionKind } from '../../src/types';
import {
  formatRegisterChanges,
  isPreparedRegisterCorrection,
  isRegisterCorrectionDecisionReceipt,
} from '../../src/utils/register-corrections';

const PREPARATION: RegisterCorrectionPreparation = {
  operationId: 'correction-a',
  appointment: 'appointment-a',
  correctsId: 'entry-a',
  authorityEvidence: 'authority-a',
  effectiveOn: '2026-09-20',
  authority: 'director_resolution',
  approvingDirector: 'Synthetic Director',
  authorityReference: 'SYNTHETIC-1',
  reason: 'Reverse the duplicate issue',
};

function correction(overrides: Partial<RegisterCorrection> = {}): RegisterCorrection {
  return {
    uuid: 'correction-a',
    company: 'company-a',
    register: 'register-a',
    corrects: 'entry-a',
    baseSequence: 2,
    baseHash: 'f'.repeat(64),
    effectiveOn: '2026-09-20',
    changes: [{ member: 'member-a', shares: '-5' }],
    authority: 'director_resolution',
    approvingDirector: 'Synthetic Director',
    authorityReference: 'SYNTHETIC-1',
    reason: 'Reverse the duplicate issue',
    sourceDocument: null,
    evidenceFingerprint: 'e'.repeat(64),
    evidenceSnapshot: {},
    authorityEvidence: 'authority-a',
    preparingAppointment: 'appointment-a',
    preparedByName: 'Synthetic Preparer',
    providedBy: 'company',
    submittedBy: 1,
    status: 'submitted',
    stage: 'submitted',
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: '',
    appliedEntry: null,
    decisions: [],
    createdAt: '2026-10-05T00:00:00Z',
    ...overrides,
  };
}

it('accepts a prepared correction that carries exactly the request', () => {
  expect(isPreparedRegisterCorrection(correction(), PREPARATION)).toBe(true);
});

it('reads a court order without an approving director as one that names none', () => {
  const court = { ...PREPARATION, authority: 'court_order' as const, approvingDirector: undefined };
  expect(isPreparedRegisterCorrection(correction({ authority: 'court_order', approvingDirector: '' }), court)).toBe(
    true,
  );
});

it.each<[string, Partial<RegisterCorrection>]>([
  ['operation', { uuid: 'correction-b' }],
  ['entry corrected', { corrects: 'entry-b' }],
  ['preparing appointment', { preparingAppointment: 'appointment-b' }],
  ['authority document', { authorityEvidence: 'authority-b' }],
  ['effective date', { effectiveOn: '2026-09-21' }],
  ['authority', { authority: 'court_order' }],
  ['approving director', { approvingDirector: 'Another Director' }],
  ['authority reference', { authorityReference: 'SYNTHETIC-2' }],
  ['reason', { reason: 'Another reason' }],
  ['provider', { providedBy: 'staff_verified' }],
])('refuses a prepared correction with another %s', (_field, change) => {
  expect(isPreparedRegisterCorrection(correction(change), PREPARATION)).toBe(false);
});

const DIGEST = 'b'.repeat(64);
const DECIDED_AT = '2026-10-05T00:00:00Z';

function receipt(kind: RegisterDecisionKind) {
  const reason = kind === 'reject' ? 'Stale' : '';
  const effect =
    kind === 'apply'
      ? { status: 'applied' as const, reviewedAt: DECIDED_AT, appliedEntry: 'entry-c' }
      : kind === 'reject'
        ? { status: 'rejected' as const, reviewedAt: DECIDED_AT, rejectionReason: reason }
        : {};
  return {
    request: {
      appointment: 'appointment-a',
      kind,
      reason,
      idempotencyKey: 'key-a',
      previewDigest: DIGEST,
      confirmation: true,
    },
    proposal: correction({
      ...effect,
      decisions: [
        {
          uuid: 'decision-a',
          kind,
          appointment: 'appointment-a',
          idempotencyKey: 'key-a',
          digest: DIGEST,
          reason,
          decidedAt: DECIDED_AT,
          decidedBy: 1,
          decidedByName: 'Synthetic Decider',
        },
      ],
    }),
  };
}

it.each<RegisterDecisionKind>(['approve', 'apply', 'reject'])('accepts the exact %s receipt', (kind) => {
  const { request, proposal } = receipt(kind);
  expect(isRegisterCorrectionDecisionReceipt(proposal, 'correction-a', request)).toBe(true);
});

it.each<[RegisterDecisionKind, string, Partial<RegisterCorrection>]>([
  ['apply', 'no applied entry', { appliedEntry: null }],
  ['apply', 'another status', { status: 'submitted' }],
  ['apply', 'another review time', { reviewedAt: '2026-10-05T00:00:01Z' }],
  ['approve', 'another correction', { uuid: 'correction-b' }],
  ['reject', 'another rejection reason', { rejectionReason: 'Another reason' }],
])('refuses the %s receipt with %s', (kind, _field, change) => {
  const { request, proposal } = receipt(kind);
  expect(isRegisterCorrectionDecisionReceipt({ ...proposal, ...change }, 'correction-a', request)).toBe(false);
});

it('refuses a receipt whose decision has another retry key, kind, appointment, digest or reason', () => {
  const { request, proposal } = receipt('reject');
  for (const change of [
    { idempotencyKey: 'key-b' },
    { kind: 'approve' as const },
    { appointment: 'appointment-b' },
    { digest: 'c'.repeat(64) },
    { reason: 'Another reason' },
  ]) {
    const decisions = [{ ...proposal.decisions[0]!, ...change }];
    expect(isRegisterCorrectionDecisionReceipt({ ...proposal, decisions }, 'correction-a', request)).toBe(false);
  }
});

it('formats each change as a signed whole-share count beside the member it names', () => {
  expect(
    formatRegisterChanges([
      { member: 'member-a', name: 'Mia Member', shares: '1000' },
      { member: 'member-b', name: 'Ben Member', shares: '-9007199254740993' },
    ]),
  ).toEqual(['Mia Member: +1,000', 'Ben Member: -9,007,199,254,740,993']);
});

it('names a correction change after the entry it reverses, and a member nothing names by its ID', () => {
  const entry = [
    { member: 'member-a', name: 'Mia Member', shares: '5' },
    { member: 'member-b', name: null, shares: '5' },
  ];
  expect(
    formatRegisterChanges(
      [
        { member: 'member-a', shares: '-5' },
        { member: 'member-b', shares: '-5' },
        { member: 'member-c', shares: '-5' },
      ],
      entry,
    ),
  ).toEqual([
    'Mia Member: -5',
    `${REGISTER_CORRECTION_COPY.UNNAMED_MEMBER('member-b')}: -5`,
    `${REGISTER_CORRECTION_COPY.UNNAMED_MEMBER('member-c')}: -5`,
  ]);
});

it("keeps a change's own name over the entry's", () => {
  expect(
    formatRegisterChanges(
      [{ member: 'member-a', name: 'Mia Renamed', shares: '-5' }],
      [{ member: 'member-a', name: 'Mia Member', shares: '5' }],
    ),
  ).toEqual(['Mia Renamed: -5']);
});
