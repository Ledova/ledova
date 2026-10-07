import { REGISTER_LINK_COPY } from '../../src/constants/business/register-links';
import { REGISTER_OPENING_COPY } from '../../src/constants/business/register-openings';
import type { RegisterLink, RegisterLinkPreparation, TokenHoldersResponse } from '../../src/types';
import {
  isPreparedRegisterLink,
  isRegisterLinkDecisionReceipt,
  registerLinkMemberLabels,
  registerLinkOf,
} from '../../src/utils/register-links';

const ADA = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa';
const CY = '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC';
const MEMBER_A = '10000000-0000-4000-8000-0000000000aa';
const MEMBER_B = '10000000-0000-4000-8000-0000000000bb';

const PREPARATION: RegisterLinkPreparation = {
  operationId: 'link-a',
  appointment: 'appointment-a',
  companyId: 'company-a',
  authorityEvidence: 'authority-a',
  mapping: [
    { address: CY, member: MEMBER_B },
    { address: ADA, member: MEMBER_A },
  ],
  authority: 'director_resolution',
  approvingDirector: 'Synthetic Director',
  authorityReference: 'SYNTHETIC-LINK-1',
  reason: "Link the new subscribers' wallets to their member records",
};

function link(overrides: Partial<RegisterLink> = {}): RegisterLink {
  return {
    uuid: 'link-a',
    company: 'company-a',
    mapping: [
      { address: ADA, member: MEMBER_A },
      { address: CY, member: MEMBER_B },
    ],
    mappingSummary: [
      { address: ADA, member: MEMBER_A, memberExists: true },
      { address: CY, member: MEMBER_B, memberExists: false },
    ],
    authority: 'director_resolution',
    approvingDirector: 'Synthetic Director',
    authorityReference: 'SYNTHETIC-LINK-1',
    reason: "Link the new subscribers' wallets to their member records",
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
    decisions: [],
    createdAt: '2026-10-07T00:00:00Z',
    ...overrides,
  };
}

it('accepts a prepared link that carries exactly the request, whatever order its mapping arrives in', () => {
  expect(isPreparedRegisterLink(link(), PREPARATION)).toBe(true);
  const reordered = link({
    mapping: [
      { member: MEMBER_B, address: CY },
      { member: MEMBER_A, address: ADA },
    ],
  });
  expect(isPreparedRegisterLink(reordered, PREPARATION)).toBe(true);
});

it('reads an address spelled in another case as the same, as the server stores it checksummed', () => {
  const spelled = {
    ...PREPARATION,
    mapping: [
      { address: ADA.toLowerCase(), member: MEMBER_A },
      { address: CY.toUpperCase().replace('0X', '0x'), member: MEMBER_B },
    ],
  };
  expect(isPreparedRegisterLink(link(), spelled)).toBe(true);
});

it('reads a court order without an approving director as one that names none', () => {
  const court = { ...PREPARATION, authority: 'court_order' as const, approvingDirector: undefined };
  expect(isPreparedRegisterLink(link({ authority: 'court_order', approvingDirector: '' }), court)).toBe(true);
});

it.each<[string, Partial<RegisterLink>]>([
  ['operation', { uuid: 'link-b' }],
  ['company', { company: 'company-b' }],
  ['preparing appointment', { preparingAppointment: 'appointment-b' }],
  ['authority document', { authorityEvidence: 'authority-b' }],
  ['authority', { authority: 'court_order' }],
  ['approving director', { approvingDirector: 'Another Director' }],
  ['authority reference', { authorityReference: 'SYNTHETIC-LINK-2' }],
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
])('refuses a prepared link with another %s', (_field, change) => {
  expect(isPreparedRegisterLink(link(change), PREPARATION)).toBe(false);
});

it('narrows a record whose mapping is rows of an address and a member', () => {
  const { mapping, ...record } = link();
  expect(registerLinkOf({ ...record, mapping })).toEqual(link());
});

describe('registerLinkMemberLabels', () => {
  const NEW_MEMBER = REGISTER_OPENING_COPY.NEW_MEMBER_NUMBERED;
  const FIRST = '20000000-0000-4000-8000-000000000001';
  const SECOND = '20000000-0000-4000-8000-000000000002';
  const THIRD = '20000000-0000-4000-8000-000000000003';
  const WALLET_ONE = '0x5B38Da6a701c568545dCfcB03FcB875f56beddC4';
  const WALLET_TWO = '0xAb8483F64d9C6d1EcF9b849Ae677dD3315835cb2';
  const WALLET_THREE = '0x4B20993Bc481177ec7E8f571ceCaE8A9e22C02db';

  function holder(
    member: string,
    name: string | null,
    wallets: string[] = [],
    balance = '10',
    shareClass = 'ORD',
  ): TokenHoldersResponse['holders'][number] {
    return {
      member,
      name,
      holderType: name ? 'member' : 'unidentified',
      balance,
      shareClass,
      source: 'register',
      identitySource: name ? 'particulars' : 'none',
      enteredOn: '2026-09-20',
      percentage: 10,
      wallets: wallets.map((address) => ({ address, whitelistStatus: 'Active' })),
    };
  }

  const existing = (member: string) => ({ member, memberExists: true });
  const created = (member: string) => ({ member, memberExists: false });

  it('numbers each new member by its first wallet in recorded order, so wallets on one new member read alike', () => {
    expect([...registerLinkMemberLabels([created(SECOND), created(FIRST), created(SECOND)], [])]).toEqual([
      [SECOND, NEW_MEMBER(1)],
      [FIRST, NEW_MEMBER(2)],
    ]);
  });

  it('labels a current member by a name no other current member shares, whether or not it is mapped', () => {
    expect([...registerLinkMemberLabels([], [holder(MEMBER_A, '  Ada Member ', [WALLET_ONE])])]).toEqual([
      [MEMBER_A, 'Ada Member'],
    ]);
  });

  it('gives an unnamed current member its first wallet shortened, or its first holding when it has no wallet', () => {
    const labels = registerLinkMemberLabels(
      [],
      [
        holder(FIRST, null, [WALLET_ONE, WALLET_TWO]),
        holder(SECOND, '  ', [], '1200', 'PREF'),
        holder(SECOND, null, [], '7', 'ORD'),
      ],
    );
    expect([...labels]).toEqual([
      [FIRST, `${REGISTER_LINK_COPY.UNNAMED_MEMBER} · 0x5B38…ddC4`],
      [SECOND, `${REGISTER_LINK_COPY.UNNAMED_MEMBER} · ${REGISTER_LINK_COPY.HOLDING('1,200', 'PREF')}`],
    ]);
  });

  it('tells apart current members who share a name, in any letter case, by the same detail', () => {
    const labels = registerLinkMemberLabels(
      [],
      [holder(FIRST, 'Sam Example', [WALLET_ONE]), holder(SECOND, 'sam example ', [WALLET_TWO]), holder(THIRD, 'Ada')],
    );
    expect([...labels.values()]).toEqual(['Sam Example · 0x5B38…ddC4', 'sam example · 0xAb84…5cb2', 'Ada']);
  });

  it('keeps every label whatever the mapping, so two unnamed members crossed between two wallets never swap', () => {
    const holders = [
      holder(MEMBER_A, 'Alex Member'),
      holder(FIRST, null, [WALLET_ONE]),
      holder(SECOND, null, [WALLET_TWO]),
    ];
    const crossed = registerLinkMemberLabels([existing(SECOND), existing(FIRST)], holders);
    expect(crossed).toEqual(registerLinkMemberLabels([existing(FIRST), existing(SECOND)], holders));
    expect(crossed).toEqual(registerLinkMemberLabels([], holders));
    expect(crossed.get(FIRST)).not.toBe(crossed.get(SECOND));
    expect([...crossed.values()].filter((label) => /[0-9a-f]{8}-[0-9a-f]{4}-/.test(label))).toEqual([]);
  });

  it('gives an existing member who is no longer a current member a neutral label, told apart from another', () => {
    expect([...registerLinkMemberLabels([existing(FIRST)], [])]).toEqual([[FIRST, REGISTER_LINK_COPY.NOT_ON_REGISTER]]);
    expect([...registerLinkMemberLabels([existing(SECOND), existing(FIRST), existing(SECOND)], [])]).toEqual([
      [SECOND, `${REGISTER_LINK_COPY.NOT_ON_REGISTER} (1)`],
      [FIRST, `${REGISTER_LINK_COPY.NOT_ON_REGISTER} (2)`],
    ]);
  });

  it('tells apart current members whose labels would still read alike, in the order the registers list them', () => {
    const labels = registerLinkMemberLabels(
      [],
      [holder(SECOND, null), holder(FIRST, null), holder(THIRD, null, [WALLET_THREE])],
    );
    const shared = `${REGISTER_LINK_COPY.UNNAMED_MEMBER} · ${REGISTER_LINK_COPY.HOLDING('10', 'ORD')}`;
    expect([...labels]).toEqual([
      [SECOND, `${shared} (1)`],
      [FIRST, `${shared} (2)`],
      [THIRD, `${REGISTER_LINK_COPY.UNNAMED_MEMBER} · 0x4B20…02db`],
    ]);
  });
});

it('recovers an exact retained approval after application while refusing changed mapping or decision keys', () => {
  const request = {
    appointment: 'appointment-a',
    kind: 'approve' as const,
    idempotencyKey: 'approval-key',
    previewDigest: 'd'.repeat(64),
    reason: '',
    confirmation: true,
  };
  const approval = {
    uuid: 'approval',
    appointment: request.appointment,
    kind: request.kind,
    idempotencyKey: request.idempotencyKey,
    digest: request.previewDigest,
    reason: '',
    decidedBy: 1,
    decidedByName: 'Synthetic Approver',
    decidedAt: '2026-10-07T01:00:00Z',
  };
  const applied = link({
    status: 'applied',
    stage: 'applied',
    reviewedAt: '2026-10-07T02:00:00Z',
    decisions: [
      approval,
      {
        ...approval,
        uuid: 'application',
        kind: 'apply',
        idempotencyKey: 'apply-key',
        decidedAt: '2026-10-07T02:00:00Z',
      },
    ],
  });
  const preview = {
    previewDigest: request.previewDigest,
    canDecide: true,
    unmetRequirements: [],
    links: applied.mapping.map((row) => ({
      ...row,
      memberExists: true,
      walletProof: 'proven' as const,
      holderType: 'member' as const,
      holderName: 'Synthetic Member',
    })),
  };
  expect(isRegisterLinkDecisionReceipt(applied, applied.uuid, request, preview)).toBe(true);
  expect(isRegisterLinkDecisionReceipt(applied, applied.uuid, { ...request, idempotencyKey: 'other' }, preview)).toBe(
    false,
  );
  expect(
    isRegisterLinkDecisionReceipt(
      { ...applied, mapping: [{ address: ADA, member: MEMBER_B }] },
      applied.uuid,
      request,
      preview,
    ),
  ).toBe(false);
  expect(
    isRegisterLinkDecisionReceipt(
      { ...applied, decisions: [{ ...approval, appointment: 'foreign' }] },
      applied.uuid,
      request,
      preview,
    ),
  ).toBe(false);
});
