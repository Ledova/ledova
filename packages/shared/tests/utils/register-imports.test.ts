import type { OwnCompanyAppointment, RegisterEvidence, RegisterImport } from '../../src/types';
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
    status: 'current',
    ...overrides,
  } as OwnCompanyAppointment;
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

it('accepts an evidence receipt only for the exact upload', () => {
  const request = {
    companyId: 'company-a',
    appointment: 'appointment-a',
    kind: 'share_register' as const,
    idempotencyKey: 'key-a',
  };
  const receipt = {
    uuid: 'register-a',
    company: 'company-a',
    appointment: 'appointment-a',
    kind: 'share_register',
    idempotencyKey: 'key-a',
    fileSize: 4,
    sha256: 'a'.repeat(64),
    providedBy: 'company',
  } as RegisterEvidence;
  expect(isRegisterEvidenceReceipt(receipt, request, 4)).toBe(true);
  for (const changed of [
    { ...receipt, fileSize: 5 },
    { ...receipt, kind: 'asic_extract' as const },
    { ...receipt, idempotencyKey: 'key-b' },
    { ...receipt, sha256: 'not-a-digest' },
  ])
    expect(isRegisterEvidenceReceipt(changed, request, 4)).toBe(false);
});

it('accepts a prepared import only when it carries exactly the request', () => {
  expect(isPreparedRegisterImport(proposal(), PREPARATION)).toBe(true);
  for (const changed of [
    proposal({ asicIssuedTotal: '1' }),
    proposal({ members: [{ ...MEMBER, shares: '1' }] }),
    proposal({ preparingAppointment: 'appointment-b' }),
    proposal({ providedBy: 'staff_verified' }),
  ])
    expect(isPreparedRegisterImport(changed, PREPARATION)).toBe(false);
});

it('accepts a decision receipt only with the matching decision and effect', () => {
  const request = {
    appointment: 'appointment-a',
    kind: 'apply' as const,
    reason: '',
    idempotencyKey: 'key-a',
    previewDigest: 'b'.repeat(64),
    confirmation: true,
  };
  const decision = {
    uuid: 'decision-a',
    kind: 'apply' as const,
    appointment: 'appointment-a',
    idempotencyKey: 'key-a',
    digest: 'b'.repeat(64),
    reason: '',
    decidedAt: '2026-10-05T00:00:00Z',
    decidedBy: 1,
    decidedByName: 'Synthetic Applier',
  };
  const applied = proposal({ status: 'applied', reviewedAt: decision.decidedAt, decisions: [decision] });
  expect(isRegisterImportDecisionReceipt(applied, 'import-a', request)).toBe(true);
  expect(isRegisterImportDecisionReceipt(applied, 'import-b', request)).toBe(false);
  expect(isRegisterImportDecisionReceipt(proposal({ decisions: [decision] }), 'import-a', request)).toBe(false);
  expect(isRegisterImportDecisionReceipt(applied, 'import-a', { ...request, previewDigest: 'c'.repeat(64) })).toBe(
    false,
  );
  const rejection = { ...decision, kind: 'reject' as const, reason: 'Stale' };
  expect(
    isRegisterImportDecisionReceipt(
      proposal({
        status: 'rejected',
        reviewedAt: decision.decidedAt,
        rejectionReason: 'Stale',
        decisions: [rejection],
      }),
      'import-a',
      { ...request, kind: 'reject', reason: 'Stale' },
    ),
  ).toBe(true);
  const approval = { ...decision, kind: 'approve' as const };
  expect(
    isRegisterImportDecisionReceipt(proposal({ decisions: [approval] }), 'import-a', { ...request, kind: 'approve' }),
  ).toBe(true);
});
