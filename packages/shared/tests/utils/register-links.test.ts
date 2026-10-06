import type { RegisterLink, RegisterLinkPreparation } from '../../src/types';
import { isPreparedRegisterLink, registerLinkOf } from '../../src/utils/register-links';

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
