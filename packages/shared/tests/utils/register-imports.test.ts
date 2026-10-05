import type { RegisterImport } from '../../src/types';
import { isPreparedRegisterImport, registerImportTotals } from '../../src/utils/register-imports';

const MEMBER = {
  member: 'member-a',
  name: 'Synthetic Member',
  residentialAddress: '1 Synthetic Street',
  shares: '9007199254740993',
  enteredOn: '2019-05-01',
  amountPaid: null,
};

const PREPARATION = {
  operationId: 'import-a',
  appointment: 'appointment-a',
  tokenId: 'class-a',
  registerEvidence: 'register-a',
  asicEvidence: 'asic-a',
  asicIssuedTotal: '9007199254740993',
  asicMemberCount: 1,
  asAt: '2026-09-20',
  members: [MEMBER],
  formerMembers: [],
  authority: 'director_resolution' as const,
  authorityReference: 'SYNTHETIC-1',
  reason: 'Import the register',
};

function proposal(overrides: Partial<RegisterImport> = {}): RegisterImport {
  return {
    uuid: 'import-a',
    token: 'class-a',
    preparingAppointment: 'appointment-a',
    registerEvidence: 'register-a',
    asicEvidence: 'asic-a',
    asicIssuedTotal: '9007199254740993',
    asicMemberCount: 1,
    asAt: '2026-09-20',
    providedBy: 'company',
    members: [MEMBER],
    formerMembers: [],
    status: 'submitted',
    stage: 'submitted',
    reviewedAt: null,
    rejectionReason: '',
    decisions: [],
    ...overrides,
  } as RegisterImport;
}

it('adds whole-share totals exactly beyond the safe integer range', () => {
  expect(registerImportTotals([{ shares: '9007199254740993' }, { shares: '1' }])).toEqual({
    total: '9007199254740994',
    count: 2,
  });
});

it('accepts a prepared import that carries exactly the request, whatever order its row keys arrive in', () => {
  expect(isPreparedRegisterImport(proposal(), PREPARATION)).toBe(true);
  const { name, member, shares, enteredOn, amountPaid, residentialAddress } = MEMBER;
  const stored = { name, member, shares, enteredOn, amountPaid, residentialAddress };
  expect(isPreparedRegisterImport(proposal({ members: [stored] }), PREPARATION)).toBe(true);
});

it.each<[string, Partial<RegisterImport>]>([
  ['operation', { uuid: 'import-b' }],
  ['share class', { token: 'class-b' }],
  ['preparing appointment', { preparingAppointment: 'appointment-b' }],
  ['register evidence', { registerEvidence: 'register-b' }],
  ['ASIC evidence', { asicEvidence: 'asic-b' }],
  ['stated issued total', { asicIssuedTotal: '1' }],
  ['stated member count', { asicMemberCount: 2 }],
  ['register date', { asAt: '2026-09-21' }],
  ['provider', { providedBy: 'staff_verified' }],
  ['member ID', { members: [{ ...MEMBER, member: 'member-b' }] }],
  ['member name', { members: [{ ...MEMBER, name: 'Another Member' }] }],
  ['member address', { members: [{ ...MEMBER, residentialAddress: '9 Other Street' }] }],
  ['member shares', { members: [{ ...MEMBER, shares: '1' }] }],
  ['member date entered', { members: [{ ...MEMBER, enteredOn: '2019-05-02' }] }],
  ['member amount paid', { members: [{ ...MEMBER, amountPaid: '1.00' }] }],
  ['number of members', { members: [MEMBER, { ...MEMBER, member: 'member-b' }] }],
  [
    'number of former members',
    {
      formerMembers: [
        { name: 'Synthetic Former', residentialAddress: '2 Synthetic Road', shares: '40', ceasedOn: '2022-03-01' },
      ],
    },
  ],
])('refuses a prepared import with another %s', (_field, change) => {
  expect(isPreparedRegisterImport(proposal(change), PREPARATION)).toBe(false);
});
