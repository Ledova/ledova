import type { RegisterDecisionKind, RegisterOpening, RegisterOpeningPreparation } from '../../src/types';
import { isRegisterDecisionReceipt } from '../../src/utils/register-commands';
import { isPreparedRegisterOpening, registerOpeningOf } from '../../src/utils/register-openings';

const ADA = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa';
const CY = '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC';
const MEMBER_A = '10000000-0000-4000-8000-0000000000aa';
const MEMBER_B = '10000000-0000-4000-8000-0000000000bb';

const PREPARATION: RegisterOpeningPreparation = {
  operationId: 'opening-a',
  appointment: 'appointment-a',
  tokenId: 'class-a',
  authorityEvidence: 'authority-a',
  mapping: [
    { address: CY, member: MEMBER_B },
    { address: ADA, member: MEMBER_A },
  ],
  authority: 'director_resolution',
  approvingDirector: 'Synthetic Director',
  authorityReference: 'SYNTHETIC-1',
  reason: 'Open the register from the chain',
};

function opening(overrides: Partial<RegisterOpening> = {}): RegisterOpening {
  return {
    uuid: 'opening-a',
    company: 'company-a',
    token: 'class-a',
    mapping: [
      { address: ADA, member: MEMBER_A },
      { address: CY, member: MEMBER_B },
    ],
    boundary: {},
    boundarySummary: {
      blockNumber: 12,
      blockHash: '0x' + 'c'.repeat(64),
      date: '2026-09-20',
      holdings: [
        { address: ADA, shares: '80', member: MEMBER_A, memberName: 'Ada Member', memberExists: true },
        { address: CY, shares: '20', member: MEMBER_B, memberName: null, memberExists: false },
      ],
    },
    authority: 'director_resolution',
    approvingDirector: 'Synthetic Director',
    authorityReference: 'SYNTHETIC-1',
    reason: 'Open the register from the chain',
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

it('accepts a prepared opening that carries exactly the request, whatever order its mapping arrives in', () => {
  expect(isPreparedRegisterOpening(opening(), PREPARATION)).toBe(true);
  const reordered = opening({
    mapping: [
      { member: MEMBER_B, address: CY },
      { member: MEMBER_A, address: ADA },
    ],
  });
  expect(isPreparedRegisterOpening(reordered, PREPARATION)).toBe(true);
});

it('reads an address or member UUID spelled in another case as the same', () => {
  const spelled = {
    ...PREPARATION,
    mapping: [
      { address: ADA.toLowerCase(), member: MEMBER_A.toUpperCase() },
      { address: CY.toUpperCase().replace('0X', '0x'), member: MEMBER_B },
    ],
  };
  expect(isPreparedRegisterOpening(opening(), spelled)).toBe(true);
});

it('reads a court order without an approving director as one that names none', () => {
  const court = { ...PREPARATION, authority: 'court_order' as const, approvingDirector: undefined };
  expect(isPreparedRegisterOpening(opening({ authority: 'court_order', approvingDirector: '' }), court)).toBe(true);
});

it('accepts an empty opening prepared with an empty mapping', () => {
  expect(isPreparedRegisterOpening(opening({ mapping: [] }), { ...PREPARATION, mapping: [] })).toBe(true);
});

it.each<[string, Partial<RegisterOpening>]>([
  ['operation', { uuid: 'opening-b' }],
  ['share class', { token: 'class-b' }],
  ['preparing appointment', { preparingAppointment: 'appointment-b' }],
  ['authority document', { authorityEvidence: 'authority-b' }],
  ['authority', { authority: 'court_order' }],
  ['approving director', { approvingDirector: 'Another Director' }],
  ['authority reference', { authorityReference: 'SYNTHETIC-2' }],
  ['reason', { reason: 'Another reason' }],
  ['provider', { providedBy: 'staff_verified' }],
  [
    'member for an address',
    {
      mapping: [
        { address: ADA, member: MEMBER_B },
        { address: CY, member: MEMBER_B },
      ],
    },
  ],
  [
    'address',
    {
      mapping: [
        { address: '0x' + '1'.repeat(40), member: MEMBER_A },
        { address: CY, member: MEMBER_B },
      ],
    },
  ],
  ['missing address', { mapping: [{ address: ADA, member: MEMBER_A }] }],
  [
    'extra address',
    {
      mapping: [
        { address: ADA, member: MEMBER_A },
        { address: CY, member: MEMBER_B },
        { address: '0x' + '1'.repeat(40), member: MEMBER_B },
      ],
    },
  ],
])('refuses a prepared opening with another %s', (_field, change) => {
  expect(isPreparedRegisterOpening(opening(change), PREPARATION)).toBe(false);
});

it('narrows a record whose mapping is rows of an address and a member', () => {
  const { mapping, ...record } = opening();
  expect(registerOpeningOf({ ...record, mapping })).toEqual(opening());
});

const DIGEST = 'b'.repeat(64);
const DECIDED_AT = '2026-10-05T00:00:00Z';

function receipt(kind: RegisterDecisionKind) {
  const reason = kind === 'reject' ? 'The boundary moved' : '';
  const effect =
    kind === 'apply'
      ? { status: 'applied' as const, reviewedAt: DECIDED_AT, appliedEntry: 'entry-a' }
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
    proposal: opening({
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

it.each<RegisterDecisionKind>(['approve', 'apply', 'reject'])('accepts the exact opening %s receipt', (kind) => {
  const { request, proposal } = receipt(kind);
  expect(isRegisterDecisionReceipt(proposal, 'opening-a', request)).toBe(true);
});

it.each<[RegisterDecisionKind, string, Partial<RegisterOpening>]>([
  ['approve', 'another opening', { uuid: 'opening-b' }],
  ['approve', 'a decided opening', { status: 'applied' }],
  ['apply', 'an opening still prepared', { status: 'submitted' }],
  ['apply', 'another review time', { reviewedAt: '2026-10-05T00:00:01Z' }],
  ['reject', 'another rejection reason', { rejectionReason: 'Another reason' }],
  ['reject', 'an applied opening', { status: 'applied' }],
])('refuses the opening %s receipt for %s', (kind, _field, change) => {
  const { request, proposal } = receipt(kind);
  expect(isRegisterDecisionReceipt({ ...proposal, ...change }, 'opening-a', request)).toBe(false);
});

it('refuses an opening receipt whose decision has another retry key, kind, appointment, digest or reason', () => {
  const { request, proposal } = receipt('reject');
  for (const change of [
    { idempotencyKey: 'key-b' },
    { kind: 'approve' as const },
    { appointment: 'appointment-b' },
    { digest: 'c'.repeat(64) },
    { reason: 'Another reason' },
  ]) {
    const decisions = [{ ...proposal.decisions[0]!, ...change }];
    expect(isRegisterDecisionReceipt({ ...proposal, decisions }, 'opening-a', request)).toBe(false);
  }
});
