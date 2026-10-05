import type {
  OwnCompanyAppointment,
  RegisterDecisionKind,
  RegisterEvidence,
  RegisterEvidenceKind,
  RegisterImport,
} from '../../src/types';
import {
  appointmentForRegisterStep,
  isRegisterDecisionReceipt,
  isRegisterEvidenceReceipt,
  rowsOf,
} from '../../src/utils/register-commands';

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

it('picks an effective appointment of the company that holds administration or the step', () => {
  const appointments = [
    appointment('c', { capabilities: ['admin'] }),
    appointment('b', { capabilities: ['approve'] }),
    appointment('a', { capabilities: ['read_register'] }),
    appointment('d', { capabilities: ['apply'], isEffective: false }),
    appointment('e', { capabilities: ['apply'], company: 'company-b' }),
  ];
  expect(appointmentForRegisterStep(appointments, 'company-a', 'reject')?.uuid).toBe('b');
  expect(appointmentForRegisterStep(appointments, 'company-a', 'apply')?.uuid).toBe('c');
  expect(appointmentForRegisterStep(appointments.slice(1), 'company-a', 'apply')).toBeUndefined();
  expect(appointmentForRegisterStep(appointments.slice(2), 'company-a', 'prepare')).toBeUndefined();
});

it.each<[OwnCompanyAppointment['capabilities'][number], string[]]>([
  ['admin', ['prepare', 'approve', 'apply', 'reject']],
  ['prepare', ['prepare']],
  ['approve', ['approve', 'reject']],
  ['apply', ['apply']],
  ['read_register', []],
  ['finance', []],
])('lets an appointment holding %s take the steps %j', (capability, steps) => {
  const held = [appointment('a', { capabilities: [capability] })];
  expect(
    (['prepare', 'approve', 'apply', 'reject'] as const).filter((step) =>
      appointmentForRegisterStep(held, 'company-a', step),
    ),
  ).toEqual(steps);
});

it('counts only an active, effective appointment that has not expired, as the company team page does', () => {
  const step = (overrides: Partial<OwnCompanyAppointment>) =>
    appointmentForRegisterStep([appointment('a', { capabilities: ['approve'], ...overrides })], 'company-a', 'approve')
      ?.uuid;
  expect(step({})).toBe('a');
  expect(step({ expiresAt: '2999-01-01T00:00:00Z' })).toBe('a');
  expect(step({ status: 'revoked', revokedAt: '2026-10-04T00:00:00Z' })).toBeUndefined();
  expect(step({ status: 'expired' })).toBeUndefined();
  expect(step({ expiresAt: '2020-01-01T00:00:00Z' })).toBeUndefined();
  expect(step({ expiresAt: 'not a date' })).toBeUndefined();
});

it('reads rows only when every row carries each text field and each optional field is text or null', () => {
  expect(rowsOf([{ member: 'a', shares: '1', note: null }], ['member', 'shares'], ['note'])).toBe(true);
  expect(rowsOf([], ['member'])).toBe(true);
  for (const value of [
    undefined,
    null,
    {},
    [null],
    ['row'],
    [{ member: 'a' }],
    [{ member: 'a', shares: 1 }],
    [{ member: 'a', shares: '1', note: 2 }],
  ])
    expect(rowsOf(value, ['member', 'shares'], ['note'])).toBe(false);
});

const UPLOAD = {
  companyId: 'company-a',
  appointment: 'appointment-a',
  kind: 'share_register' as RegisterEvidenceKind,
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

it.each<RegisterEvidenceKind>(['share_register', 'asic_extract', 'authority', 'supporting'])(
  'accepts a %s evidence receipt for the exact upload',
  (kind) => {
    expect(isRegisterEvidenceReceipt({ ...RECEIPT, kind }, { ...UPLOAD, kind }, 4)).toBe(true);
  },
);

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

it('refuses an authority receipt that names another kind of evidence', () => {
  expect(isRegisterEvidenceReceipt(RECEIPT, { ...UPLOAD, kind: 'authority' }, 4)).toBe(false);
});

const DIGEST = 'b'.repeat(64);
const DECIDED_AT = '2026-10-05T00:00:00Z';

function proposal(overrides: Partial<RegisterImport> = {}): RegisterImport {
  return {
    uuid: 'import-a',
    status: 'submitted',
    stage: 'submitted',
    reviewedAt: null,
    rejectionReason: '',
    decisions: [],
    members: [],
    formerMembers: [],
    ...overrides,
  } as unknown as RegisterImport;
}

function receipt(kind: RegisterDecisionKind) {
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

it.each<RegisterDecisionKind>(['approve', 'apply', 'reject'])('accepts the exact %s receipt', (kind) => {
  const { request, proposal: decided } = receipt(kind);
  expect(isRegisterDecisionReceipt(decided, 'import-a', request)).toBe(true);
});

it('reads an approval or application without a reason as one that gives none', () => {
  const { request, proposal: decided } = receipt('approve');
  expect(isRegisterDecisionReceipt(decided, 'import-a', { ...request, reason: undefined })).toBe(true);
});

it.each<[RegisterDecisionKind, string, (decided: RegisterImport) => RegisterImport]>([
  ['apply', 'proposal', (decided) => ({ ...decided, uuid: 'import-b' })],
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
  expect(isRegisterDecisionReceipt(change(decided), 'import-a', request)).toBe(false);
});
