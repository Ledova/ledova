import type {
  OwnCompanyAppointment,
  RegisterEvidence,
  RegisterImport,
  RegisterImportDecisionKind,
} from '../../src/types';
import {
  appointmentForRegisterImportStep,
  isPreparedRegisterImport,
  isRegisterEvidenceReceipt,
  isRegisterImportDecisionReceipt,
  registerImportTotals,
} from '../../src/utils/register-imports';

function appointment(uuid: string, overrides: Partial<OwnCompanyAppointment> = {}): OwnCompanyAppointment {
  return {
    uuid,
    company: 'company-a',
    companyName: 'Synthetic Pty Ltd',
    capabilities: ['prepare'],
    delegatableCapabilities: [],
    createdAt: '2026-10-01T00:00:00Z',
    declarationText: null,
    declarationVersion: null,
    expiresAt: null,
    isEffective: true,
    revokedAt: null,
    source: 'invitation',
    status: 'active',
    ...overrides,
  };
}

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

it('picks an effective appointment of the company that holds administration or the step', () => {
  const appointments = [
    appointment('c', { capabilities: ['admin'] }),
    appointment('b', { capabilities: ['approve'] }),
    appointment('a', { capabilities: ['read_register'] }),
    appointment('d', { capabilities: ['apply'], isEffective: false }),
    appointment('e', { capabilities: ['apply'], company: 'company-b' }),
  ];
  expect(appointmentForRegisterImportStep(appointments, 'company-a', 'reject')?.uuid).toBe('b');
  expect(appointmentForRegisterImportStep(appointments, 'company-a', 'apply')?.uuid).toBe('c');
  expect(appointmentForRegisterImportStep(appointments.slice(1), 'company-a', 'apply')).toBeUndefined();
  expect(appointmentForRegisterImportStep(appointments.slice(2), 'company-a', 'prepare')).toBeUndefined();
});

it('counts only an active, effective appointment that has not expired, as the company team page does', () => {
  const step = (overrides: Partial<OwnCompanyAppointment>) =>
    appointmentForRegisterImportStep(
      [appointment('a', { capabilities: ['approve'], ...overrides })],
      'company-a',
      'approve',
    )?.uuid;
  expect(step({})).toBe('a');
  expect(step({ expiresAt: '2999-01-01T00:00:00Z' })).toBe('a');
  expect(step({ status: 'revoked', revokedAt: '2026-10-04T00:00:00Z' })).toBeUndefined();
  expect(step({ status: 'expired' })).toBeUndefined();
  expect(step({ expiresAt: '2020-01-01T00:00:00Z' })).toBeUndefined();
  expect(step({ expiresAt: 'not a date' })).toBeUndefined();
});

const UPLOAD = {
  companyId: 'company-a',
  appointment: 'appointment-a',
  kind: 'share_register' as const,
  idempotencyKey: 'key-a',
};

const RECEIPT = {
  uuid: 'register-a',
  company: 'company-a',
  appointment: 'appointment-a',
  kind: 'share_register',
  idempotencyKey: 'key-a',
  originalFilename: 'register.pdf',
  fileSize: 4,
  mimeType: 'application/pdf',
  sha256: 'a'.repeat(64),
  providedBy: 'company',
  createdAt: '2026-10-05T00:00:00Z',
} satisfies RegisterEvidence;

it('accepts an evidence receipt for the exact upload', () => {
  expect(isRegisterEvidenceReceipt(RECEIPT, UPLOAD, 4)).toBe(true);
});

it.each<[string, Partial<RegisterEvidence>]>([
  ['company', { company: 'company-b' }],
  ['appointment', { appointment: 'appointment-b' }],
  ['kind', { kind: 'asic_extract' }],
  ['retry key', { idempotencyKey: 'key-b' }],
  ['size', { fileSize: 5 }],
  ['digest', { sha256: 'not-a-digest' }],
  ['provider', { providedBy: 'staff' }],
])('refuses an evidence receipt with another %s', (_field, change) => {
  expect(isRegisterEvidenceReceipt({ ...RECEIPT, ...change }, UPLOAD, 4)).toBe(false);
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

const DIGEST = 'b'.repeat(64);
const DECIDED_AT = '2026-10-05T00:00:00Z';

function receipt(kind: RegisterImportDecisionKind) {
  const reason = kind === 'reject' ? 'Stale' : '';
  const decision = {
    uuid: 'decision-a',
    kind,
    appointment: 'appointment-a',
    idempotencyKey: 'key-a',
    digest: DIGEST,
    reason,
    decidedAt: DECIDED_AT,
    decidedBy: 1,
    decidedByName: 'Synthetic Decider',
  };
  const effect =
    kind === 'apply'
      ? { status: 'applied' as const, reviewedAt: DECIDED_AT }
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
    proposal: proposal({ ...effect, decisions: [decision] }),
  };
}

function decisionOf(decided: RegisterImport, change: Partial<RegisterImport['decisions'][number]>) {
  return { ...decided, decisions: [{ ...decided.decisions[0]!, ...change }] };
}

it.each<RegisterImportDecisionKind>(['approve', 'apply', 'reject'])('accepts the exact %s receipt', (kind) => {
  const { request, proposal: decided } = receipt(kind);
  expect(isRegisterImportDecisionReceipt(decided, 'import-a', request)).toBe(true);
});

it.each<[RegisterImportDecisionKind, string, (decided: RegisterImport) => RegisterImport]>([
  ['apply', 'import', (decided) => ({ ...decided, uuid: 'import-b' })],
  ['apply', 'retry key', (decided) => decisionOf(decided, { idempotencyKey: 'key-b' })],
  ['apply', 'decision kind', (decided) => decisionOf(decided, { kind: 'approve' })],
  ['apply', 'decision appointment', (decided) => decisionOf(decided, { appointment: 'appointment-b' })],
  ['apply', 'decision digest', (decided) => decisionOf(decided, { digest: 'c'.repeat(64) })],
  ['apply', 'review time', (decided) => ({ ...decided, reviewedAt: '2026-10-05T00:00:01Z' })],
  ['apply', 'status', (decided) => ({ ...decided, status: 'submitted' })],
  ['approve', 'decision reason', (decided) => decisionOf(decided, { reason: 'Unexpected' })],
  ['approve', 'status', (decided) => ({ ...decided, status: 'applied' })],
  [
    'reject',
    'decision reason',
    (decided) => ({ ...decisionOf(decided, { reason: 'Another reason' }), rejectionReason: 'Another reason' }),
  ],
  ['reject', 'rejection reason', (decided) => ({ ...decided, rejectionReason: 'Another reason' })],
  ['reject', 'review time', (decided) => ({ ...decided, reviewedAt: '2026-10-05T00:00:01Z' })],
  ['reject', 'status', (decided) => ({ ...decided, status: 'applied' })],
])('refuses the %s receipt with another %s', (kind, _field, change) => {
  const { request, proposal: decided } = receipt(kind);
  expect(isRegisterImportDecisionReceipt(change(decided), 'import-a', request)).toBe(false);
});
